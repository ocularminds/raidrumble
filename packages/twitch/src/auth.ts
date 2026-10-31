import { randomBytes } from 'node:crypto';
import type { OAuthRole, OAuthState, OAuthTokens, TwitchIdentity } from './model.js';
import { count, identifier, record, strings } from './parse.js';
import { TwitchHttpError } from './read.js';

export const oauthScopes: Record<OAuthRole, readonly string[]> = {
  host: [
    'channel:bot',
    'user:read:follows',
    'moderator:manage:shoutouts',
    'moderator:read:chatters',
    'channel:manage:redemptions',
  ],
  bot: ['user:read:chat', 'user:write:chat', 'user:bot'],
  raider: ['channel:bot'],
  warlord: [],
};

interface PendingState {
  context: OAuthState;
  expiresAt: number;
}

/** Server memory only; bind browserId to an HttpOnly SameSite session cookie. */
export class OAuthStateStore {
  private readonly pending = new Map<string, PendingState>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: { now?: () => number; ttlMs?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 600_000;
  }

  issue(context: OAuthState): string {
    if (!context.browserId) throw new Error('OAuth requires a browser session');
    const now = this.now();
    for (const [key, entry] of this.pending) if (entry.expiresAt <= now) this.pending.delete(key);
    if (this.pending.size >= 10_000) throw new Error('Too many pending OAuth sessions');
    const state = randomBytes(32).toString('base64url');
    this.pending.set(state, { context: { ...context }, expiresAt: now + this.ttlMs });
    return state;
  }

  consume(state: string, browserId: string): OAuthState | null {
    const entry = this.pending.get(state);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.pending.delete(state);
      return null;
    }
    if (entry.context.browserId !== browserId) return null;
    this.pending.delete(state);
    return { ...entry.context };
  }
}

export interface OAuthClientOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/** Identity credential exchange is not a channel action; see AGENTS §4.3. */
export class OAuthClient {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: OAuthClientOptions) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  authorizationUrl(state: string, scopes: readonly string[]): string {
    const query = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state: identifier(state, 'OAuth state'),
      force_verify: 'true',
    });
    return `https://id.twitch.tv/oauth2/authorize?${query}`;
  }

  exchange(code: string): Promise<OAuthTokens> {
    return this.token({
      grant_type: 'authorization_code',
      code: identifier(code, 'authorization code'),
      redirect_uri: this.options.redirectUri,
    });
  }

  refresh(refreshToken: string): Promise<OAuthTokens> {
    return this.token({
      grant_type: 'refresh_token',
      refresh_token: identifier(refreshToken, 'refresh token'),
    });
  }

  async validate(accessToken: string): Promise<TwitchIdentity> {
    const response = await this.fetcher('https://id.twitch.tv/oauth2/validate', {
      method: 'GET',
      headers: { Authorization: `OAuth ${accessToken}` },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000),
    });
    if (!response.ok) throw new TwitchHttpError(response.status);
    const body = record(await response.json(), 'token validation');
    if (body.client_id !== this.options.clientId)
      throw new Error('Twitch token belongs to a different client');
    return {
      userId: identifier(body.user_id, 'authenticated user ID'),
      login: identifier(body.login, 'authenticated user login'),
      scopes: strings(body.scopes, 'token scopes'),
      expiresIn: count(body.expires_in, 'token expiry'),
    };
  }

  private async token(parameters: Record<string, string>): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      ...parameters,
    });
    const response = await this.fetcher('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000),
    });
    if (!response.ok) throw new TwitchHttpError(response.status);
    const data = record(await response.json(), 'token response');
    const expiresIn = count(data.expires_in, 'token expiry');
    if (!expiresIn) throw new Error('Twitch token is already expired');
    return {
      accessToken: identifier(data.access_token, 'access token'),
      refreshToken: identifier(data.refresh_token, 'refresh token'),
      expiresAt: this.now() + expiresIn * 1000,
      scopes: strings(data.scope ?? [], 'token scopes'),
    };
  }
}

/** Coalesces refreshes because Twitch rotates refresh tokens. Never serialize to UI. */
export class TokenSession {
  private tokens: OAuthTokens;
  private pending?: Promise<OAuthTokens>;

  constructor(
    tokens: OAuthTokens,
    private readonly refresh: (refreshToken: string) => Promise<OAuthTokens>,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = { ...tokens, scopes: [...tokens.scopes] };
  }

  async accessToken(): Promise<string> {
    if (this.tokens.expiresAt > this.now() + 60_000) return this.tokens.accessToken;
    if (!this.pending) {
      this.pending = this.refresh(this.tokens.refreshToken)
        .then((tokens) => {
          this.tokens = { ...tokens, scopes: [...tokens.scopes] };
          return this.tokens;
        })
        .finally(() => {
          this.pending = undefined;
        });
    }
    return (await this.pending).accessToken;
  }

  snapshot(): OAuthTokens {
    return { ...this.tokens, scopes: [...this.tokens.scopes] };
  }
}
