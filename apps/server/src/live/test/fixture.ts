import Fastify from 'fastify';
import { LocalPolicyGate } from '@raidrumble/policy';
import { oauthScopes, type EventSubOptions, type OAuthRole } from '@raidrumble/twitch';
import { vi } from 'vitest';
import { LiveService } from '../index.js';
import type { LiveOptions } from '../model.js';

export class FakeClient {
  started = false;
  stopped = false;
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopped' = 'idle';
  readonly options: EventSubOptions;
  constructor(options: EventSubOptions) {
    this.options = {
      ...options,
      onSession: (sessionId, context) => {
        this.status = 'connected';
        return options.onSession(sessionId, context);
      },
    };
  }
  start(): void {
    this.started = true;
    this.status = 'connecting';
  }
  stop(): void {
    this.stopped = true;
    this.status = 'stopped';
  }
}

export function fixture(overrides: Partial<LiveOptions> = {}) {
  const sockets: FakeClient[] = [];
  const gates = new Map<string, LocalPolicyGate>();
  let now = 1_798_000_000_000;
  const onHost = vi.fn();
  const onRaid = vi.fn();
  const onChat = vi.fn();
  const onShared = vi.fn();
  const onRedemption = vi.fn();
  const onRoster = vi.fn();
  const onError = vi.fn();
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/oauth2/token') {
      const form = new URLSearchParams(String(init?.body));
      const code = form.get('code') ?? form.get('refresh_token') ?? '10:host';
      const [id, role = 'host'] = code.split(':');
      return Response.json({
        access_token: `${id}:${role}`,
        refresh_token: `${id}:${role}`,
        expires_in: 3600,
        scope: oauthScopes[role as OAuthRole],
        token_type: 'bearer',
      });
    }
    if (url.pathname === '/oauth2/validate') {
      const header = new Headers(init?.headers).get('Authorization') ?? '';
      const [id, role = 'host'] = header.replace('OAuth ', '').split(':');
      return Response.json({
        client_id: 'client',
        login: `stream${id}`,
        user_id: id,
        scopes: oauthScopes[role as OAuthRole],
        expires_in: 3600,
      });
    }
    if (url.pathname === '/helix/users')
      return Response.json({
        data: url.searchParams.getAll('id').map((id) => ({
          id,
          login: `stream${id}`,
          display_name: `Stream ${id}`,
          created_at: '2020-01-01T00:00:00Z',
          broadcaster_type: 'affiliate',
        })),
      });
    if (url.pathname === '/helix/channels')
      return Response.json({
        data: url.searchParams.getAll('broadcaster_id').map((id) => ({
          broadcaster_id: id,
          broadcaster_login: `stream${id}`,
          broadcaster_name: `Stream ${id}`,
          title: `Channel ${id}`,
          game_id: '1',
          game_name: id === '10' ? 'Gardening' : 'Speedrunning',
          tags: ['English'],
        })),
      });
    if (url.pathname === '/helix/channels/followed')
      return Response.json({ data: [], pagination: {}, total: 0 });
    if (url.pathname === '/helix/eventsub/subscriptions')
      return Response.json(
        {
          data: [
            {
              id: 'subscription',
              status: 'enabled',
              ...(JSON.parse(String(init?.body)) as Record<string, unknown>),
            },
          ],
        },
        { status: 202 },
      );
    throw new Error('Unexpected fixture request');
  });
  const service = new LiveService({
    clientId: 'client',
    clientSecret: 'secret',
    botUserId: '20',
    baseUrl: 'http://localhost:3000',
    dashboardUrl: 'http://localhost:5174',
    onHost,
    onRaid,
    onChat,
    onShared,
    onRedemption,
    onRoster,
    onError,
    fetch: fetcher,
    now: () => now,
    getGate: (hostId) => {
      let gate = gates.get(hostId);
      if (!gate) {
        gate = new LocalPolicyGate(undefined, { now: () => now, logger: () => undefined });
        gate.setMode('events.subscribe', 'enforce');
        gates.set(hostId, gate);
      }
      return gate;
    },
    createEventSub: (options) => {
      const client = new FakeClient(options);
      sockets.push(client);
      return client;
    },
    ...overrides,
  });
  const app = Fastify();
  service.register(app);
  return {
    app,
    service,
    sockets,
    gates,
    fetcher,
    onHost,
    onRaid,
    onChat,
    onShared,
    onRedemption,
    onRoster,
    onError,
    setNow: (value: number) => {
      now = value;
    },
  };
}

export async function begin(
  f: ReturnType<typeof fixture>,
  role: OAuthRole,
  cookie?: string,
  query = '',
) {
  const response = await f.app.inject({
    method: 'GET',
    url: `/auth/${role}${query}`,
    ...(cookie ? { headers: { cookie } } : {}),
  });
  const setCookie = response.headers['set-cookie'];
  const sessionCookie =
    cookie ?? (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0];
  const location = String(response.headers.location ?? '');
  const state = location ? new URL(location).searchParams.get('state') : null;
  return { response, cookie: sessionCookie ?? '', state: state ?? '' };
}

export async function login(
  f: ReturnType<typeof fixture>,
  role: OAuthRole,
  id: string,
  cookie?: string,
  query = '',
) {
  const flow = await begin(f, role, cookie, query);
  const response = await f.app.inject({
    method: 'GET',
    url: `/auth/callback?state=${encodeURIComponent(flow.state)}&code=${id}:${role}`,
    headers: { cookie: flow.cookie },
  });
  return { ...flow, response };
}
