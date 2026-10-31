import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { Ledger } from '@raidrumble/ledger';
import { OpenAiContent } from '@raidrumble/content';
import {
  DecionisGate,
  LocalPolicyGate,
  loadPolicy,
  type ConfigurablePolicyGate,
} from '@raidrumble/policy';
import { fileURLToPath } from 'node:url';
import type { WebSocket } from 'ws';
import { Rooms } from './services/rooms.js';
import { SettingsStore } from './services/settings.js';
import { LiveService, resolveTwitchConfig } from './live/index.js';
import { registerHost } from './routes/host.js';
import { registerDemo } from './routes/demo.js';
import { registerStream } from './routes/stream.js';
import { StreamActions } from './services/stream.js';
import { authorityConfig } from './services/authority.js';

export interface AppOptions {
  ledgerPath?: string;
  settingsPath?: string;
  autoTick?: boolean;
  quiet?: boolean;
  now?: () => number;
  openai?: boolean;
}

export async function createApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: !options.quiet,
    bodyLimit: 16384,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const ledger = new Ledger(options.ledgerPath ?? ':memory:');
  const policy = await loadPolicy(
    fileURLToPath(new URL('../../../policy/raidrumble.policy.yaml', import.meta.url)),
  );
  const { gateKind, initialMode, decionis } = authorityConfig(process.env);
  if (initialMode) policy.defaults.mode = initialMode;
  const rosterGates = new Map<string, ConfigurablePolicyGate>();
  const rooms = new Rooms({
    ledger,
    regularsPath: options.ledgerPath ?? ':memory:',
    settings: new SettingsStore(options.settingsPath),
    config: policy,
    gateKind,
    decionis,
    quiet: options.quiet,
    now: options.now,
    generator:
      options.openai !== false && process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL
        ? new OpenAiContent(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL)
        : undefined,
  });
  const baseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';
  const dashboardUrl = process.env.DASHBOARD_URL ?? 'http://localhost:5174';
  const overlayBase = process.env.OVERLAY_URL ?? 'http://localhost:5173';
  const origins = new Set([baseUrl, dashboardUrl, overlayBase].map((url) => new URL(url).origin));
  await app.register(cors, { origin: [...origins], credentials: true });
  app.addHook('onRequest', async (request, reply) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      if (origin && !origins.has(origin))
        return reply.code(403).send({ error: 'Untrusted request origin.' });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const status =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 400;
    void reply.code(status >= 400 && status < 500 ? status : 500).send({
      error:
        status < 500
          ? 'Invalid request or channel not connected.'
          : 'The action could not be completed.',
    });
  });
  const live = new LiveService({
    ...resolveTwitchConfig(process.env, baseUrl, dashboardUrl),
    baseUrl,
    dashboardUrl,
    onHost: (profile) => {
      rooms.addHost(profile);
      rooms.beginStream(profile.id);
    },
    onRaid: async (hostId, raid) => {
      await rooms.raid(hostId, {
        channels: raid.channels,
        raiderLogin: raid.raiderLogin,
        accountAgeDays: raid.accountAgeDays,
        hostFollowsRaider: raid.hostFollowsRaider,
        viewers: raid.viewers,
        occurredAt: raid.occurredAt,
        roster: new Set(live.roster(raid.channels.raider.id)),
        onComplete: () => live.clearRoster(raid.channels.raider.id),
      });
    },
    onChat: async (hostId, event) => {
      await rooms.get(hostId).chat({
        userId: event.userId,
        text: event.text,
        displayName: event.displayName,
        sourceBroadcasterId: event.sourceBroadcasterId,
        occurredAt: event.occurredAt,
      });
    },
    onShared: (hostId, participants) => {
      rooms.shared.set(hostId, participants);
    },
    onRedemption: async (hostId, event) => {
      const rewardId = rooms.rewardIds.get(hostId);
      if (rewardId)
        await rooms.get(hostId).reinforce(
          {
            userId: event.userId,
            rewardId: event.rewardId,
            status: event.status,
            redemptionId: event.redemptionId,
          },
          rewardId,
        );
    },
    getGate: (hostId) => {
      const room = rooms.all.get(hostId);
      if (room) return room.gate;
      let gate = rosterGates.get(hostId);
      if (!gate) {
        const Gate = gateKind === 'decionis' ? DecionisGate : LocalPolicyGate;
        gate = new Gate(policy, {
          ...decionis,
          ...(options.quiet ? { logger: () => undefined } : {}),
        });
        rosterGates.set(hostId, gate);
      }
      return gate;
    },
    onError: (hostId, message) => {
      app.log.warn({ hostId, message }, 'Twitch connection needs attention');
    },
  });
  await live.register(app);
  registerHost(app, { rooms, live, overlayBase });
  registerDemo(app, rooms);
  const actions = new StreamActions(rooms, live);
  registerStream(app, { rooms, live, actions });
  app.get('/health', async () => ({ status: 'ok', service: 'RaidRumble', policy: gateKind }));
  await app.register(websocket);
  const clients = new Map<WebSocket, () => unknown>();
  app.get<{ Params: { hostId: string } }>('/ws/:hostId', { websocket: true }, (socket, request) => {
    const room = rooms.all.get(request.params.hostId);
    if (!room) {
      socket.close(1008, 'Unknown channel');
      return;
    }
    const read = () => room.view();
    clients.set(socket, read);
    socket.send(JSON.stringify(read()));
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });
  app.get<{ Params: { matchId: string } }>(
    '/ws/mirror/:matchId',
    { websocket: true },
    (socket, request) => {
      const room = [...rooms.all.values()].find((room) => room.matchId === request.params.matchId);
      if (!room) {
        socket.close(1008, 'Unknown match');
        return;
      }
      const read = () =>
        room.matchId === request.params.matchId ? room.view() : { hostId: 'ended', status: 'idle' };
      clients.set(socket, read);
      socket.send(JSON.stringify(read()));
      socket.on('close', () => clients.delete(socket));
      socket.on('error', () => clients.delete(socket));
    },
  );
  let previous = performance.now();
  const timer =
    options.autoTick === false
      ? undefined
      : setInterval(() => {
          const now = performance.now();
          const dt = Math.min(2000, now - previous);
          previous = now;
          rooms.step(dt);
          void actions.step().catch(() => undefined);
          for (const [client, read] of clients) {
            try {
              if (client.readyState === 1 && client.bufferedAmount < 262144)
                client.send(JSON.stringify(read()));
            } catch {
              clients.delete(client);
            }
          }
        }, 100);
  app.addHook('onClose', async () => {
    clearInterval(timer);
    await live.stop();
    for (const client of clients.keys()) client.close();
    try {
      await rooms.close();
    } finally {
      ledger.close();
    }
  });
  return { app, rooms, live, ledger };
}
