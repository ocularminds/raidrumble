import { PolicyExecutor, type HelixCredentials, type HelixWrite } from '@raidrumble/policy';
import {
  EventSubClient,
  OAuthClient,
  SubscriptionPlan,
  type ChatNotification,
  type EventSubOptions,
  type TwitchNotification,
} from '@raidrumble/twitch';
import type { LiveAccount, LiveClient, LiveOptions, LiveProfile, LiveStatus } from './model.js';
import { enrichRaid } from './profile.js';
import { SharedChannels } from './shared.js';
import { ChannelQueue } from './queue.js';

interface HostReadiness {
  required: Set<string>;
  confirmed: Set<string>;
}
interface EventReceipt {
  count: number;
  last: NonNullable<LiveStatus['lastEvent']>;
}

/** Routes authenticated channels; gameplay and viewer attribution remain in Room. */
export class LiveEvents {
  private readonly hosts = new Map<string, LiveAccount>();
  private readonly raiders = new Map<string, LiveAccount>();
  private readonly clients = new Map<string, LiveClient>();
  private readonly rosters = new Map<string, Map<string, number>>();
  private bot?: LiveAccount;
  private botClient?: LiveClient;
  private botSession?: string;
  private botSubscribed = new Set<string>();
  private botConfirmed = new Set<string>();
  private readonly hostReadiness = new Map<string, HostReadiness>();
  private readonly received = new Map<string, EventReceipt>();
  private readonly issues = new Map<string, { order: number; message: string }>();
  private issueSequence = 0;
  private validationTimer?: ReturnType<typeof setInterval>;
  private readonly shared: SharedChannels;
  private readonly setup = new ChannelQueue();

  constructor(
    private readonly options: LiveOptions,
    private readonly oauth: OAuthClient | undefined,
    private readonly now: () => number,
  ) {
    this.shared = new SharedChannels(options);
  }

  async addHost(account: LiveAccount): Promise<void> {
    const hostId = account.identity.userId;
    this.clients.get(hostId)?.stop();
    this.hosts.set(hostId, account);
    this.hostReadiness.delete(hostId);
    this.received.delete(hostId);
    this.shared.clear(hostId);
    let activeSession: string | undefined;
    const client = this.create({
      onSession: async (sessionId, { reconnected }) => {
        if (this.hosts.get(hostId) !== account || account.revoked) return;
        activeSession = sessionId;
        if (reconnected) {
          if (!this.status(hostId).hostEventsConnected)
            this.report(hostId, 'Twitch setup changed during reconnect. Reconnect this channel.');
          return;
        }
        const subscribed = new Set<string>();
        const plan = SubscriptionPlan.host(sessionId, hostId, this.options.botUserId ?? hostId, {
          rewards: account.profile.affiliate,
        }).filter((write) => write.body?.type !== 'channel.chat.message');
        const readiness = {
          required: new Set(plan.map((write) => String(write.body?.type))),
          confirmed: new Set<string>(),
        };
        this.hostReadiness.set(hostId, readiness);
        this.issues.delete(`host:${hostId}`);
        const current = () =>
          this.hosts.get(hostId) === account &&
          !account.revoked &&
          activeSession === sessionId &&
          (client.status === undefined || client.status === 'connected') &&
          this.hostReadiness.get(hostId) === readiness;
        await Promise.all(
          plan.map(async (write) => {
            if (await this.subscribe(hostId, account, write, subscribed, current))
              readiness.confirmed.add(String(write.body?.type));
          }),
        );
      },
      onNotification: (event) => this.hostEvent(hostId, account, event),
      onRevocation: () => {
        account.revoked = true;
        this.shared.clear(hostId);
        client.stop();
        this.report(hostId, 'Twitch authorization was revoked. Reconnect this channel.');
      },
      onError: () => this.report(hostId, 'Twitch event connection interrupted; reconnecting.'),
    });
    this.clients.set(hostId, client);
    client.start();
    this.scheduleValidation();
    await this.subscribeChat(hostId);
  }

  async addRaider(account: LiveAccount): Promise<void> {
    const id = account.identity.userId;
    this.raiders.set(id, account);
    this.scheduleValidation();
    await this.subscribeChat(id);
  }

  async setBot(account: LiveAccount): Promise<void> {
    this.botClient?.stop();
    this.bot = account;
    this.botSession = undefined;
    this.botSubscribed = new Set();
    this.botConfirmed = new Set();
    const client = this.create({
      onSession: async (sessionId, { reconnected }) => {
        if (this.bot !== account || account.revoked) return;
        this.botSession = sessionId;
        this.issues.delete('bot');
        const channels = new Set([...this.hosts.keys(), ...this.raiders.keys()]);
        if (reconnected) {
          if ([...channels].some((id) => !this.botConfirmed.has(id)))
            this.report('', 'Twitch chat setup changed during reconnect. Reconnect the bot.');
          return;
        }
        this.botSubscribed = new Set();
        this.botConfirmed = new Set();
        await Promise.all([...channels].map((channelId) => this.subscribeChat(channelId)));
      },
      onNotification: (event) =>
        this.bot === account && !account.revoked ? this.chatEvent(event) : undefined,
      onRevocation: () => {
        account.revoked = true;
        client.stop();
        this.report('', 'Twitch bot authorization was revoked. Reconnect the bot.');
      },
      onError: () => this.report('', 'Twitch chat connection interrupted; reconnecting.'),
    });
    this.botClient = client;
    client.start();
    this.scheduleValidation();
  }

  status(hostId: string): LiveStatus {
    const host = this.hosts.get(hostId);
    const hostConnected = Boolean(host && !host.revoked);
    const botConnected = Boolean(this.bot && !this.bot.revoked);
    const hostState = this.clients.get(hostId)?.status;
    const botState = this.botClient?.status;
    const readiness =
      hostConnected && hostState === 'connected' ? this.hostReadiness.get(hostId) : undefined;
    const hostEventsConnected = Boolean(
      readiness?.required.size &&
      [...readiness.required].every((type) => readiness.confirmed.has(type)),
    );
    const chatEventsConnected =
      hostConnected && botConnected && botState === 'connected' && this.botConfirmed.has(hostId);
    const receipt = this.received.get(hostId);
    const issue = [`host:${hostId}`, `chat:${hostId}`, 'bot']
      .map((key) => this.issues.get(key))
      .filter((item) => item !== undefined)
      .sort((a, b) => b.order - a.order)[0];
    const interrupted =
      (hostConnected && hostState === 'reconnecting') ||
      (botConnected && botState === 'reconnecting');
    const stopped =
      (hostConnected && hostState === 'stopped') || (botConnected && botState === 'stopped');
    const setupError =
      issue?.message ??
      (interrupted
        ? 'Twitch event connection interrupted; reconnecting.'
        : stopped
          ? 'Twitch event connection stopped. Reconnect this account.'
          : undefined);
    return {
      configured: Boolean(this.options.clientId && this.options.clientSecret),
      hostConnected,
      botConnected,
      hostEventsConnected,
      chatEventsConnected,
      subscriptions: [
        ...(readiness?.confirmed ?? []),
        ...(chatEventsConnected ? ['channel.chat.message'] : []),
      ].sort(),
      eventCount: receipt?.count ?? 0,
      ...(receipt ? { lastEvent: { ...receipt.last } } : {}),
      ...(setupError ? { setupError } : {}),
    };
  }

  profile(hostId: string): LiveProfile | undefined {
    const account = this.hosts.get(hostId);
    return account && !account.revoked ? structuredClone(account.profile) : undefined;
  }

  sharedChannels(hostId: string): readonly { id: string; name: string }[] {
    const account = this.hosts.get(hostId);
    return account && !account.revoked ? this.shared.get(hostId) : [];
  }

  async credentials(hostId: string, role: 'host' | 'bot'): Promise<HelixCredentials | undefined> {
    const host = this.hosts.get(hostId);
    const account = role === 'host' ? host : this.bot;
    if (!host || host.revoked || !account || account.revoked || !this.options.clientId)
      return undefined;
    return {
      clientId: this.options.clientId,
      accessToken: await account.tokens.accessToken(),
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    };
  }

  roster(channelId: string): readonly string[] {
    const roster = this.rosters.get(channelId);
    if (!roster) return [];
    for (const [userId, atMs] of roster) if (atMs < this.now() - 30 * 60_000) roster.delete(userId);
    return [...roster.keys()];
  }

  clearRoster(channelId: string): void {
    this.rosters.delete(channelId);
  }

  stop(): void {
    if (this.validationTimer) clearInterval(this.validationTimer);
    this.validationTimer = undefined;
    for (const client of this.clients.values()) client.stop();
    this.botClient?.stop();
    this.clients.clear();
    this.hosts.clear();
    this.raiders.clear();
    this.rosters.clear();
    this.bot = undefined;
    this.botClient = undefined;
    this.botSession = undefined;
    this.botSubscribed.clear();
    this.botConfirmed.clear();
    this.hostReadiness.clear();
    this.received.clear();
    this.issues.clear();
    this.issueSequence = 0;
    this.shared.clear();
  }

  private create(options: EventSubOptions): LiveClient {
    return this.options.createEventSub?.(options) ?? new EventSubClient(options);
  }

  private async subscribeChat(channelId: string): Promise<void> {
    const account = this.hosts.get(channelId) ?? this.raiders.get(channelId);
    const bot = this.bot;
    if (!account || account.revoked || !bot || bot.revoked || !this.botSession) return;
    const sessionId = this.botSession;
    const write = SubscriptionPlan.subscription(sessionId, 'channel.chat.message', {
      broadcaster_user_id: channelId,
      user_id: bot.identity.userId,
    });
    const confirmed = this.botConfirmed;
    const current = () =>
      this.bot === bot &&
      !bot.revoked &&
      !account.revoked &&
      this.botSession === sessionId &&
      (this.botClient?.status === undefined || this.botClient.status === 'connected') &&
      this.botConfirmed === confirmed &&
      (this.hosts.get(channelId) ?? this.raiders.get(channelId)) === account;
    if (await this.subscribe(channelId, bot, write, this.botSubscribed, current)) {
      confirmed.add(channelId);
      this.issues.delete(`chat:${channelId}`);
    }
  }

  private async subscribe(
    channelId: string,
    account: LiveAccount,
    write: HelixWrite,
    subscribed: Set<string>,
    current: () => boolean,
  ): Promise<boolean> {
    return this.setup.run(channelId, async () => {
      const key = `${channelId}:${String(write.body?.type)}`;
      if (!current() || subscribed.has(key)) return false;
      subscribed.add(key);
      const scope = write.body?.type === 'channel.chat.message' ? 'chat' : 'host';
      try {
        const gate = this.options.getGate(channelId);
        const decision = await gate.authorize({
          action: 'events.subscribe',
          actor: {
            kind: account.identity.userId === this.options.botUserId ? 'system' : 'host',
            twitchUserId: account.identity.userId,
          },
          channel: { hostId: channelId },
          payload: { subscription: write.body, botUserId: this.options.botUserId },
        });
        if (!current()) {
          subscribed.delete(key);
          return false;
        }
        const accessToken = await account.tokens.accessToken();
        if (!current()) {
          subscribed.delete(key);
          return false;
        }
        const result = await new PolicyExecutor(gate).executeHelix(
          decision,
          write,
          {
            clientId: this.options.clientId ?? '',
            accessToken,
            ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
          },
          current,
        );
        // An uncertain POST may have reached Twitch; keep it deduplicated for this session.
        if (!result.executed && result.reason !== 'EFFECT_FAILED') subscribed.delete(key);
        if (!current()) return false;
        if (!result.executed || !this.enabled(result.value, write)) {
          this.report(
            channelId,
            'A Twitch event subscription could not be enabled. Check authorization and policy.',
            scope,
          );
          return false;
        }
        return true;
      } catch {
        subscribed.delete(key);
        if (current())
          this.report(channelId, 'Twitch event setup failed. Reconnect this channel.', scope);
        return false;
      }
    });
  }

  private async hostEvent(
    hostId: string,
    account: LiveAccount,
    event: TwitchNotification,
  ): Promise<void> {
    if (this.hosts.get(hostId) !== account || account.revoked) return;
    try {
      if (event.type === 'raid' && event.hostId === hostId) {
        this.rememberEvent(hostId, event.type);
        await this.options.onRaid(
          hostId,
          await enrichRaid(this.options, account, event, this.now()),
        );
      } else if (event.type === 'shared' && event.channelId === hostId) {
        this.rememberEvent(hostId, event.type);
        const participants = event.phase === 'end' ? [] : [...event.participants];
        await Promise.all([
          this.shared.update(account, participants),
          this.options.onShared(hostId, participants),
        ]);
      } else if (event.type === 'redemption' && event.channelId === hostId) {
        this.rememberEvent(hostId, event.type);
        await this.options.onRedemption?.(hostId, event);
      }
    } catch {
      this.report(
        hostId,
        'A Twitch event could not be processed; the current match continues.',
        'event',
      );
    }
  }

  private async chatEvent(event: TwitchNotification): Promise<void> {
    if (event.type !== 'chat') return;
    try {
      const host = this.hosts.get(event.channelId);
      if (host && !host.revoked) {
        this.rememberEvent(event.channelId, event.type);
        await this.options.onChat(event.channelId, event);
      }
      const raider = this.raiders.get(event.channelId);
      if (
        raider &&
        !raider.revoked &&
        (!event.sourceBroadcasterId || event.sourceBroadcasterId === event.channelId)
      ) {
        this.remember(event);
        await this.options.onRoster?.(event.channelId, event);
      }
    } catch {
      this.report(
        event.channelId,
        'A chat event could not be processed; the current match continues.',
        'event',
      );
    }
  }

  private remember(event: ChatNotification): void {
    const roster = this.rosters.get(event.channelId) ?? new Map<string, number>();
    if (roster.size >= 50_000) {
      const oldest = roster.keys().next().value;
      if (oldest !== undefined) roster.delete(oldest);
    }
    roster.set(event.userId, Math.min(this.now(), event.occurredAt));
    this.rosters.set(event.channelId, roster);
  }

  private scheduleValidation(): void {
    if (this.validationTimer || !this.oauth) return;
    this.validationTimer = setInterval(() => {
      void this.validate();
    }, 3_600_000);
    this.validationTimer.unref();
  }

  private async validate(): Promise<void> {
    if (!this.oauth) return;
    const oauth = this.oauth;
    const accounts = new Set([
      ...this.hosts.values(),
      ...this.raiders.values(),
      ...(this.bot ? [this.bot] : []),
    ]);
    await Promise.all(
      [...accounts]
        .filter((account) => !account.revoked)
        .map(async (account) => {
          try {
            const identity = await oauth.validate(await account.tokens.accessToken());
            if (
              identity.userId !== account.identity.userId ||
              !account.identity.scopes.every((scope) => identity.scopes.includes(scope))
            )
              throw new Error('Authorization changed');
          } catch {
            account.revoked = true;
            if (this.bot === account) this.botClient?.stop();
            if (this.hosts.get(account.identity.userId) === account)
              this.clients.get(account.identity.userId)?.stop();
            this.clearRoster(account.identity.userId);
            this.shared.clear(account.identity.userId);
            this.report(
              this.bot === account ? '' : account.identity.userId,
              'Twitch authorization expired. Reconnect this account.',
            );
          }
        }),
    );
  }

  private rememberEvent(hostId: string, type: TwitchNotification['type']): void {
    this.received.set(hostId, {
      count: (this.received.get(hostId)?.count ?? 0) + 1,
      last: { type, atMs: this.now() },
    });
  }

  private enabled(value: unknown, write: HelixWrite): boolean {
    const data = object(value).data;
    if (!Array.isArray(data)) return false;
    const expected = write.body ?? {};
    return data.some((raw: unknown) => {
      const entry = object(raw);
      const condition = object(entry.condition);
      const transport = object(entry.transport);
      return (
        typeof entry.id === 'string' &&
        entry.id.length > 0 &&
        entry.status === 'enabled' &&
        entry.type === expected.type &&
        entry.version === expected.version &&
        Object.entries(object(expected.condition)).every(
          ([key, value]) => condition[key] === value,
        ) &&
        transport.method === 'websocket' &&
        transport.session_id === object(expected.transport).session_id
      );
    });
  }

  private report(hostId: string, message: string, scope: 'host' | 'chat' | 'event' = 'host'): void {
    if (scope !== 'event')
      this.issues.set(hostId ? `${scope}:${hostId}` : 'bot', {
        order: ++this.issueSequence,
        message,
      });
    try {
      this.options.onError?.(hostId, message);
    } catch {
      /* Diagnostics never end a match. */
    }
  }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
