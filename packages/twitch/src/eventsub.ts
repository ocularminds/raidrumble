import type { SubscriptionRevocation, TwitchNotification } from './model.js';
import { decodeNotification, parseFrame } from './events.js';
import { count, identifier, record, text } from './parse.js';
import { TwitchSocket, type EventSocket } from './socket.js';

export interface EventSubOptions {
  onSession: (sessionId: string, context: { reconnected: boolean }) => void | Promise<void>;
  onNotification: (event: TwitchNotification) => void | Promise<void>;
  onRevocation?: (subscription: SubscriptionRevocation) => void | Promise<void>;
  onError?: (error: Error) => void;
  createSocket?: (url: string) => EventSocket;
  url?: string;
  reconnectDelayMs?: number;
  now?: () => number;
}

interface Connection {
  socket: EventSocket;
  migration: boolean;
  welcomed: boolean;
  timeoutMs: number;
  watchdog?: ReturnType<typeof setTimeout>;
}

/** Owns connectivity only. The caller authorizes and executes new subscriptions. */
export class EventSubClient {
  private active?: Connection;
  private pending?: Connection;
  private retry?: ReturnType<typeof setTimeout>;
  private readonly seen = new Map<string, number>();
  private running = false;
  private attempts = 0;
  private state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopped' = 'idle';
  private readonly url: string;
  private readonly now: () => number;

  constructor(private readonly options: EventSubOptions) {
    this.url = options.url ?? 'wss://eventsub.wss.twitch.tv/ws';
    const parsed = new URL(this.url);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:')
      throw new Error('EventSub requires a websocket URL');
    this.now = options.now ?? Date.now;
  }

  get status(): typeof this.state {
    return this.state;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.state = 'connecting';
    this.connect(this.url, false);
  }

  stop(): void {
    this.running = false;
    this.state = 'stopped';
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    const connections = new Set([this.active, this.pending]);
    this.active = undefined;
    this.pending = undefined;
    for (const connection of connections) if (connection) this.dispose(connection);
    this.seen.clear();
  }

  private connect(url: string, migration: boolean): void {
    if (!this.running) return;
    try {
      const socket = (this.options.createSocket ?? ((address) => new TwitchSocket(address)))(url);
      const connection: Connection = { socket, migration, welcomed: false, timeoutMs: 10_000 };
      this.pending = connection;
      socket.onMessage((data) => this.message(connection, data));
      socket.onClose(() => this.lost(connection));
      socket.onError((error) => {
        if (this.current(connection)) this.report(error);
      });
      this.watch(connection);
    } catch (error) {
      this.report(error);
      this.schedule();
    }
  }

  private message(connection: Connection, data: string): void {
    if (!this.current(connection)) return;
    try {
      if (data.length > 1024 * 1024) throw new Error('EventSub frame exceeds size limit');
      const frame = parseFrame(JSON.parse(data) as unknown);
      const type = frame.metadata.message_type;
      if (type === 'session_welcome') {
        if (connection.welcomed) return;
        const session = record(frame.payload.session, 'session');
        const id = identifier(session.id, 'session ID');
        const seconds = count(session.keepalive_timeout_seconds, 'keepalive timeout');
        if (seconds < 1 || seconds > 600) throw new Error('Invalid Twitch keepalive timeout');
        connection.timeoutMs = seconds * 1000;
        connection.welcomed = true;
        const old = this.active;
        this.active = connection;
        this.pending = undefined;
        this.attempts = 0;
        this.state = 'connected';
        this.watch(connection);
        if (old && old !== connection) this.dispose(old);
        this.deliver(() => this.options.onSession(id, { reconnected: connection.migration }));
        return;
      }
      if (!connection.welcomed) return;
      if (type === 'session_keepalive' || type === 'notification') this.watch(connection);
      if (type === 'session_reconnect') {
        if (this.pending) return;
        const session = record(frame.payload.session, 'reconnect session');
        const url = text(session.reconnect_url, 'reconnect URL');
        const destination = new URL(url);
        if (
          destination.origin !== new URL(this.url).origin ||
          destination.username ||
          destination.password
        ) {
          throw new Error('Untrusted EventSub reconnect URL');
        }
        this.state = 'reconnecting';
        this.connect(url, true);
      } else if (type === 'notification') {
        const event = decodeNotification(frame);
        if (event && !this.duplicate(event.id))
          this.deliver(() => this.options.onNotification(event));
      } else if (type === 'revocation') {
        const subscription = record(frame.payload.subscription, 'revocation');
        const event: SubscriptionRevocation = {
          id: identifier(subscription.id, 'subscription ID'),
          type: text(subscription.type, 'subscription type'),
          status: text(subscription.status, 'subscription status'),
        };
        this.deliver(() => this.options.onRevocation?.(event));
      }
    } catch (error) {
      this.report(error);
    }
  }

  private current(connection: Connection): boolean {
    return this.running && (this.active === connection || this.pending === connection);
  }

  private duplicate(id: string): boolean {
    const now = this.now();
    for (const [key, time] of this.seen) if (now - time > 600_000) this.seen.delete(key);
    if (this.seen.has(id)) return true;
    if (this.seen.size >= 10_000) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.set(id, now);
    return false;
  }

  private watch(connection: Connection): void {
    if (connection.watchdog) clearTimeout(connection.watchdog);
    connection.watchdog = setTimeout(() => this.lost(connection), connection.timeoutMs + 1);
  }

  private lost(connection: Connection): void {
    if (!this.current(connection)) return;
    if (this.active === connection) this.active = undefined;
    if (this.pending === connection) this.pending = undefined;
    this.dispose(connection);
    if (!this.pending && !this.active) this.schedule();
    else if (this.active && !this.pending) this.state = 'connected';
  }

  private dispose(connection: Connection): void {
    if (connection.watchdog) clearTimeout(connection.watchdog);
    try {
      connection.socket.close();
    } catch (error) {
      this.report(error);
    }
  }

  private schedule(): void {
    if (!this.running || this.retry) return;
    this.state = 'reconnecting';
    const delay = Math.min(
      (this.options.reconnectDelayMs ?? 1000) * 2 ** Math.min(this.attempts++, 5),
      30_000,
    );
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.connect(this.url, false);
    }, delay);
  }

  private deliver(callback: () => void | Promise<void>): void {
    try {
      void Promise.resolve(callback()).catch((error: unknown) => this.report(error));
    } catch (error) {
      this.report(error);
    }
  }

  private report(error: unknown): void {
    try {
      this.options.onError?.(error instanceof Error ? error : new Error('Twitch transport failed'));
    } catch {
      /* Diagnostic callbacks cannot break the live connection. */
    }
  }
}
