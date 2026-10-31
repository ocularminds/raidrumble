import Fastify from 'fastify';
import { Ledger } from '@raidrumble/ledger';
import { vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { HelixCredentials } from '@raidrumble/policy';
import type { WarlordTarget } from '../src/live/index.js';
import { Rooms } from '../src/services/rooms.js';
import { SettingsStore } from '../src/services/settings.js';
import { StreamActions, type StreamLive } from '../src/services/stream.js';
import { registerStream } from '../src/routes/stream.js';

export function streamFixture() {
  let now = 10_000;
  let nextToken = 0;
  const ledger = new Ledger();
  const rooms = new Rooms({ ledger, settings: new SettingsStore(), quiet: true, now: () => now });
  const host = {
    id: '10',
    name: 'Garden',
    login: 'stream10',
    affiliate: true,
    category: 'Gardening',
    title: 'Growing together',
    tags: [],
    facts: [],
  };
  const raider = {
    id: '30',
    name: 'Speed',
    category: 'Speedrunning',
    title: 'Going fast',
    tags: [],
    facts: [],
  };
  rooms.addHost(host);
  const room = rooms.get('10');
  room.configure({ ...room.settings(), mode: 'enforce', allow: ['stream30'] });
  const links = new Map<string, WarlordTarget>();
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname.endsWith('/users'))
      return Response.json({
        data: url.searchParams.getAll('id').map((id) => ({
          id,
          login: `stream${id}`,
          display_name: `Stream ${id}`,
          broadcaster_type: 'affiliate',
          created_at: '2020-01-01T00:00:00Z',
        })),
      });
    if (url.pathname.endsWith('/channels'))
      return Response.json({
        data: url.searchParams.getAll('broadcaster_id').map((id) => ({
          broadcaster_id: id,
          broadcaster_login: `stream${id}`,
          broadcaster_name: `Stream ${id}`,
          title: `Title ${id}`,
          game_id: '1',
          game_name: 'Gardening',
          tags: [],
        })),
      });
    if (url.pathname.endsWith('/chatters'))
      return Response.json({ data: [], total: 20, pagination: {} });
    if (url.pathname.endsWith('/custom_rewards'))
      return Response.json({ data: [{ id: 'reward1' }] });
    if (url.pathname.endsWith('/shoutouts')) return new Response(null, { status: 204 });
    return Response.json({ data: [{ message_id: 'message1', is_sent: true }] });
  });
  const actor = (request: FastifyRequest) =>
    typeof request.headers['x-user'] === 'string' ? request.headers['x-user'] : undefined;
  const live: StreamLive = {
    botUserId: '20',
    profile: vi.fn(() => host),
    authorizeHost: (request, hostId) => actor(request) === hostId,
    authorizeWarlord: (request, token) => actor(request) === links.get(token)?.raiderId,
    userId: (request) => actor(request),
    credentials: vi.fn(async (_hostId, role = 'host'): Promise<HelixCredentials> => ({
      clientId: 'client',
      accessToken: `${role}Token`,
      fetch: fetcher,
    })),
    warlordLink: (hostId, raiderId, matchId) => {
      const token = `link${++nextToken}`;
      links.set(token, { hostId, raiderId, matchId, expiresAt: now + 600000 });
      return {
        token,
        url: `http://localhost:5174/warlord/${token}`,
        loginUrl: `http://localhost:3000/auth/warlord?token=${token}`,
      };
    },
    warlord: (token) => links.get(token),
    clearMatch: (matchId) => {
      for (const [token, target] of links) if (target.matchId === matchId) links.delete(token);
    },
    clearRoster: vi.fn(),
    roster: () => [],
  };
  const actions = new StreamActions(rooms, live, { now: () => now });
  const app = Fastify();
  registerStream(app, { rooms, live, actions });
  app.addHook('onClose', async () => {
    ledger.close();
  });
  const start = () =>
    rooms.raid('10', {
      channels: { host, raider },
      raiderLogin: 'stream30',
      accountAgeDays: 100,
      hostFollowsRaider: false,
      viewers: 300,
      homeMembers: 20,
    });
  return {
    app,
    rooms,
    live,
    actions,
    links,
    calls,
    fetcher,
    host,
    raider,
    start,
    advance: (dt: number) => {
      now += dt;
      rooms.step(dt);
    },
    setNow: (value: number) => {
      now = value;
    },
  };
}
