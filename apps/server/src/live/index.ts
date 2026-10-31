import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { HelixCredentials } from '@raidrumble/policy';
import { OAuthClient, TokenSession, type OAuthRole } from '@raidrumble/twitch';
import { LiveAuth } from './auth.js';
import { LiveEvents } from './events.js';
import type {
  AuthenticatedLogin,
  LiveOptions,
  LiveProfile,
  LiveStatus,
  WarlordLink,
  WarlordTarget,
} from './model.js';
import { loadProfile } from './profile.js';
import { BrowserSessions } from './sessions.js';
import { WarlordLinks } from './warlord.js';

export type {
  LiveOptions,
  LiveProfile,
  LiveRaid,
  LiveStatus,
  WarlordLink,
  WarlordTarget,
} from './model.js';

/** Composition root for real Twitch. It does not start or mutate game matches. */
export class LiveService {
  private readonly sessions: BrowserSessions;
  private readonly links: WarlordLinks;
  private readonly oauth?: OAuthClient;
  private readonly events: LiveEvents;
  private readonly auth: LiveAuth;
  private readonly now: () => number;

  constructor(private readonly options: LiveOptions) {
    this.now = options.now ?? Date.now;
    this.sessions = new BrowserSessions(options.baseUrl, options.dashboardUrl, this.now);
    this.links = new WarlordLinks(options.baseUrl, options.dashboardUrl, this.now);
    if (options.clientId && options.clientSecret && options.botUserId)
      this.oauth = new OAuthClient({
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        redirectUri: new URL('/auth/callback', options.baseUrl).toString(),
        ...(options.fetch ? { fetch: options.fetch } : {}),
        now: this.now,
      });
    this.events = new LiveEvents(options, this.oauth, this.now);
    this.auth = new LiveAuth(
      options,
      this.oauth,
      this.sessions,
      this.links,
      (role, login) => this.accept(role, login),
      this.now,
    );
  }

  register(app: FastifyInstance): void {
    this.auth.register(app);
    app.addHook('onClose', async () => {
      this.stop();
    });
  }

  authorizeHost(request: FastifyRequest, hostId: string): boolean {
    return (
      this.sessions.trustedOrigin(request) &&
      this.userId(request, 'host') === hostId &&
      this.status(hostId).hostConnected
    );
  }

  userId(request: FastifyRequest, role: 'host' | 'warlord' = 'host'): string | undefined {
    return this.sessions.identity(request, role)?.userId;
  }

  authorizeWarlord(request: FastifyRequest, token: string): boolean {
    const target = this.links.get(token);
    return Boolean(
      target &&
      this.sessions.trustedOrigin(request) &&
      this.userId(request, 'warlord') === target.raiderId,
    );
  }

  status(hostId: string): LiveStatus {
    return this.events.status(hostId);
  }
  profile(hostId: string): LiveProfile | undefined {
    return this.events.profile(hostId);
  }
  get botUserId(): string | undefined {
    return this.options.botUserId;
  }
  warlordLink(hostId: string, raiderId: string, matchId: string): WarlordLink {
    return this.links.create(hostId, raiderId, matchId);
  }
  warlord(token: string): WarlordTarget | undefined {
    return this.links.get(token);
  }
  clearMatch(matchId: string): void {
    this.links.clearMatch(matchId);
  }
  roster(channelId: string): readonly string[] {
    return this.events.roster(channelId);
  }
  clearRoster(channelId: string): void {
    this.events.clearRoster(channelId);
  }

  /** Trusted server services only. Never serialize the returned credentials to clients. */
  credentials(
    hostId: string,
    role: 'host' | 'bot' = 'host',
  ): Promise<HelixCredentials | undefined> {
    return this.events.credentials(hostId, role);
  }

  stop(): void {
    this.events.stop();
    this.sessions.clear();
    this.links.clear();
  }

  private async accept(role: OAuthRole, login: AuthenticatedLogin): Promise<void> {
    if (role === 'warlord') return;
    const oauth = this.oauth;
    if (!oauth) throw new Error('Twitch is not configured');
    const tokens = new TokenSession(
      login.tokens,
      (refreshToken) => oauth.refresh(refreshToken),
      this.now,
    );
    const profile = await loadProfile(this.options, login.identity, tokens);
    const account = { identity: login.identity, profile, tokens, revoked: false };
    if (role === 'host') {
      await this.options.onHost(profile);
      await this.events.addHost(account);
    } else if (role === 'bot') await this.events.setBot(account);
    else await this.events.addRaider(account);
  }
}
