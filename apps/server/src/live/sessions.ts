import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OAuthRole, TwitchIdentity } from '@raidrumble/twitch';

interface BrowserSession {
  id: string;
  expiresAt: number;
  identities: Partial<Record<OAuthRole, TwitchIdentity>>;
}

/** Opaque, server-held login sessions. The cookie never contains Twitch tokens. */
export class BrowserSessions {
  private readonly entries = new Map<string, BrowserSession>();
  private readonly origins: Set<string>;
  private readonly secure: boolean;
  private readonly pendingTtlMs = 10 * 60_000;
  private readonly authenticatedTtlMs = 12 * 3_600_000;

  constructor(
    baseUrl: string,
    dashboardUrl: string,
    private readonly now: () => number,
  ) {
    this.origins = new Set([new URL(baseUrl).origin, new URL(dashboardUrl).origin]);
    this.secure = new URL(baseUrl).protocol === 'https:';
  }

  get(request: FastifyRequest): BrowserSession | undefined {
    const value = request.headers.cookie
      ?.split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith('rrsession='))
      ?.slice('rrsession='.length);
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return undefined;
    const session = this.entries.get(value);
    if (session && session.expiresAt <= this.now()) {
      this.entries.delete(value);
      return undefined;
    }
    return session;
  }

  ensure(request: FastifyRequest, reply: FastifyReply): BrowserSession {
    const existing = this.get(request);
    if (existing) return existing;
    for (const [id, session] of this.entries)
      if (session.expiresAt <= this.now()) this.entries.delete(id);
    if (this.entries.size >= 10_000) throw new Error('Too many active login sessions');
    const session: BrowserSession = {
      id: randomBytes(32).toString('base64url'),
      expiresAt: this.now() + this.pendingTtlMs,
      identities: {},
    };
    this.entries.set(session.id, session);
    this.cookie(session, reply);
    return session;
  }

  setIdentity(
    browserId: string,
    role: OAuthRole,
    identity: TwitchIdentity,
    reply?: FastifyReply,
  ): void {
    const session = this.entries.get(browserId);
    if (!session || session.expiresAt <= this.now()) throw new Error('Browser session expired');
    session.identities[role] = { ...identity, scopes: [...identity.scopes] };
    session.expiresAt = this.now() + this.authenticatedTtlMs;
    if (reply) this.cookie(session, reply);
  }

  identity(request: FastifyRequest, role: OAuthRole): TwitchIdentity | undefined {
    const identity = this.get(request)?.identities[role];
    return identity ? { ...identity, scopes: [...identity.scopes] } : undefined;
  }

  trustedOrigin(request: FastifyRequest): boolean {
    const origin = request.headers.origin;
    return origin === undefined || this.origins.has(origin);
  }

  clear(): void {
    this.entries.clear();
  }

  private cookie(session: BrowserSession, reply: FastifyReply): void {
    const maxAge = Math.max(0, Math.ceil((session.expiresAt - this.now()) / 1000));
    reply.header(
      'Set-Cookie',
      `rrsession=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${this.secure ? '; Secure' : ''}`,
    );
  }
}
