import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { OAuthClient, OAuthStateStore, oauthScopes, type OAuthRole } from '@raidrumble/twitch';
import type { AuthenticatedLogin, LiveOptions } from './model.js';
import type { BrowserSessions } from './sessions.js';
import type { WarlordLinks } from './warlord.js';

interface LoginFlow {
  expiresAt: number;
  hostId?: string;
  warlordToken?: string;
}

export class LiveAuth {
  private readonly states: OAuthStateStore;
  private readonly flows = new Map<string, LoginFlow>();

  constructor(
    private readonly options: LiveOptions,
    private readonly oauth: OAuthClient | undefined,
    private readonly sessions: BrowserSessions,
    private readonly links: WarlordLinks,
    private readonly accept: (role: OAuthRole, login: AuthenticatedLogin) => Promise<void>,
    private readonly now: () => number,
  ) {
    this.states = new OAuthStateStore({ now });
  }

  register(app: FastifyInstance): void {
    for (const role of ['host', 'bot', 'raider', 'warlord'] as const) {
      app.get(`/auth/${role}`, { logLevel: 'silent' }, (request, reply) =>
        this.begin(role, request, reply),
      );
    }
    const callbackPath = new URL(this.options.redirectUri ?? '/auth/callback', this.options.baseUrl)
      .pathname;
    for (const path of new Set(['/auth/callback', callbackPath]))
      app.get(path, { logLevel: 'silent' }, (request, reply) => this.callback(request, reply));
  }

  private begin(role: OAuthRole, request: FastifyRequest, reply: FastifyReply) {
    this.privateResponse(reply);
    if (!this.oauth)
      return reply.code(503).send({ error: 'Configure Twitch credentials to connect a channel.' });
    if (role === 'bot' && !this.options.botUserId)
      return reply
        .code(503)
        .send({ error: 'Configure a Twitch bot account ID before connecting the bot.' });
    const query = request.query as Record<string, unknown>;
    const hostId = this.sessions.identity(request, 'host')?.userId;
    if (role === 'bot' && (!hostId || !this.sessions.trustedOrigin(request)))
      return reply.code(401).send({ error: 'Connect the host before connecting the bot.' });
    const token = typeof query.token === 'string' ? query.token : undefined;
    const target = token ? this.links.get(token) : undefined;
    if (role === 'warlord' && !target)
      return reply.code(404).send({ error: 'This Warlord link is invalid or expired.' });
    const browser = this.sessions.ensure(request, reply);
    const expectedUserId = role === 'bot' ? this.options.botUserId : target?.raiderId;
    const state = this.states.issue({
      browserId: browser.id,
      role,
      ...(expectedUserId ? { expectedUserId } : {}),
    });
    for (const [key, flow] of this.flows) if (flow.expiresAt <= this.now()) this.flows.delete(key);
    this.flows.set(state, {
      expiresAt: this.now() + 600_000,
      ...(hostId ? { hostId } : {}),
      ...(role === 'warlord' && token ? { warlordToken: token } : {}),
    });
    return reply.redirect(this.oauth.authorizationUrl(state, oauthScopes[role]));
  }

  private async callback(request: FastifyRequest, reply: FastifyReply) {
    this.privateResponse(reply);
    if (!this.oauth) return reply.code(503).send({ error: 'Twitch is not configured.' });
    const query = request.query as Record<string, unknown>;
    const browser = this.sessions.get(request);
    const state = typeof query.state === 'string' ? query.state : '';
    const flow = this.flows.get(state);
    if (!browser || !flow || flow.expiresAt <= this.now())
      return reply.code(400).send({ error: 'Sign-in state is invalid or expired.' });
    const context = this.states.consume(state, browser.id);
    if (!context) return reply.code(400).send({ error: 'Sign-in state is invalid or expired.' });
    this.flows.delete(state);
    if (query.error || typeof query.code !== 'string' || !query.code)
      return reply.code(400).send({ error: 'Twitch sign-in was not completed.' });
    if (flow.warlordToken && !this.links.get(flow.warlordToken))
      return reply.code(403).send({ error: 'This match link has expired.' });
    try {
      const tokens = await this.oauth.exchange(query.code);
      const identity = await this.oauth.validate(tokens.accessToken);
      if (context.expectedUserId && identity.userId !== context.expectedUserId)
        return reply
          .code(403)
          .send({ error: 'The signed-in Twitch account does not match this role.' });
      if (!oauthScopes[context.role].every((scope) => identity.scopes.includes(scope)))
        return reply.code(403).send({ error: 'Twitch did not grant the required permissions.' });
      await this.accept(context.role, { tokens: { ...tokens, scopes: identity.scopes }, identity });
      this.sessions.setIdentity(browser.id, context.role, identity);
      if (flow.warlordToken) return reply.redirect(this.links.url(flow.warlordToken));
      const destination = new URL('/', this.options.dashboardUrl);
      const hostId = context.role === 'host' ? identity.userId : flow.hostId;
      if (hostId) destination.searchParams.set('host', hostId);
      if (context.role === 'raider') destination.searchParams.set('roster', identity.userId);
      return reply.redirect(destination.toString());
    } catch {
      return reply.code(502).send({ error: 'Twitch sign-in failed. Please reconnect.' });
    }
  }

  private privateResponse(reply: FastifyReply): void {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
  }
}
