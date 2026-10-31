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
  private validationTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly options: LiveOptions,
    private readonly oauth: OAuthClient | undefined,
    private readonly now: () => number,
  ) {}

  async addHost(account: LiveAccount): Promise<void> {
    const hostId = account.identity.userId;
    this.clients.get(hostId)?.stop();
    this.hosts.set(hostId, account);
    const client = this.create({
      onSession: async (sessionId, { reconnected }) => {
        if (this.hosts.get(hostId) !== account || account.revoked || reconnected) return;
        const subscribed = new Set<string>();
        const plan = SubscriptionPlan.host(sessionId, hostId, this.options.botUserId ?? hostId, {
          rewards: account.profile.affiliate,
        }).filter((write) => write.body?.type !== 'channel.chat.message');
        await Promise.all(plan.map((write) => this.subscribe(hostId, account, write, subscribed)));
      },
      onNotification: (event) => this.hostEvent(hostId, account, event),
      onRevocation: () => {
        account.revoked = true;
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
    const client = this.create({
      onSession: async (sessionId, { reconnected }) => {
        if (this.bot !== account || account.revoked) return;
        this.botSession = sessionId;
        if (reconnected) return;
        this.botSubscribed = new Set();
        const channels = new Set([...this.hosts.keys(), ...this.raiders.keys()]);
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
    return {
      configured: Boolean(
        this.options.clientId && this.options.clientSecret && this.options.botUserId,
      ),
      hostConnected: Boolean(host && !host.revoked),
      botConnected: Boolean(this.bot && !this.bot.revoked),
    };
  }

  profile(hostId: string): LiveProfile | undefined {
    const account = this.hosts.get(hostId);
    return account && !account.revoked ? structuredClone(account.profile) : undefined;
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
  }

  private create(options: EventSubOptions): LiveClient {
    return this.options.createEventSub?.(options) ?? new EventSubClient(options);
  }

  private async subscribeChat(channelId: string): Promise<void> {
    const account = this.hosts.get(channelId) ?? this.raiders.get(channelId);
    const bot = this.bot;
    if (!account || account.revoked || !bot || bot.revoked || !this.botSession) return;
    const write = SubscriptionPlan.subscription(this.botSession, 'channel.chat.message', {
      broadcaster_user_id: channelId,
      user_id: bot.identity.userId,
    });
    await this.subscribe(channelId, bot, write, this.botSubscribed);
  }

  private async subscribe(
    channelId: string,
    account: LiveAccount,
    write: HelixWrite,
    subscribed: Set<string>,
  ): Promise<void> {
    const key = `${channelId}:${String(write.body?.type)}`;
    if (subscribed.has(key)) return;
    subscribed.add(key);
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
      const result = await new PolicyExecutor(gate).executeHelix(decision, write, {
        clientId: this.options.clientId ?? '',
        accessToken: await account.tokens.accessToken(),
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      });
      if (!result.executed) {
        subscribed.delete(key);
        this.report(
          channelId,
          'A Twitch event subscription could not be enabled. Check authorization and policy.',
        );
      }
    } catch {
      subscribed.delete(key);
      this.report(channelId, 'Twitch event setup failed. Reconnect this channel.');
    }
  }

  private async hostEvent(
    hostId: string,
    account: LiveAccount,
    event: TwitchNotification,
  ): Promise<void> {
    if (this.hosts.get(hostId) !== account || account.revoked) return;
    try {
      if (event.type === 'raid' && event.hostId === hostId) {
        await this.options.onRaid(
          hostId,
          await enrichRaid(this.options, account, event, this.now()),
        );
      } else if (event.type === 'shared' && event.channelId === hostId) {
        await this.options.onShared(hostId, event.phase === 'end' ? [] : [...event.participants]);
      } else if (event.type === 'redemption' && event.channelId === hostId) {
        await this.options.onRedemption?.(hostId, event);
      }
    } catch {
      this.report(hostId, 'A Twitch event could not be processed; the current match continues.');
    }
  }

  private async chatEvent(event: TwitchNotification): Promise<void> {
    if (event.type !== 'chat') return;
    try {
      const host = this.hosts.get(event.channelId);
      if (host && !host.revoked) await this.options.onChat(event.channelId, event);
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
            this.report(
              account.identity.userId,
              'Twitch authorization expired. Reconnect this account.',
            );
          }
        }),
    );
  }

  private report(hostId: string, message: string): void {
    try {
      this.options.onError?.(hostId, message);
    } catch {
      /* Diagnostics never end a match. */
    }
  }
}
