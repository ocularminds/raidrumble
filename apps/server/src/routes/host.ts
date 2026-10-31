import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Rooms } from '../services/rooms.js';
import { validSettings } from '../services/settings.js';
import type { LiveService } from '../live/index.js';
import { demoChannels } from '@raidrumble/content';

interface HostRoutes {
  rooms: Rooms;
  live: LiveService;
  overlayBase: string;
}

export function registerHost(app: FastifyInstance, { rooms, live, overlayBase }: HostRoutes): void {
  function authorized(request: FastifyRequest, hostId: string): boolean {
    return hostId === 'demo' || live.authorizeHost(request, hostId);
  }

  app.get<{ Params: { hostId: string } }>('/api/status/:hostId', async (request, reply) => {
    const hostId = request.params.hostId;
    if (!authorized(request, hostId))
      return reply.code(401).send({ error: 'Connect this Twitch channel first.' });
    const room = rooms.get(hostId);
    return {
      arena: room.view(),
      settings: room.settings(),
      decisions: room.gate
        .listRecords()
        .filter((decision) => decision.action !== 'content.render')
        .slice(-40)
        .reverse(),
      twitch: live.status(hostId),
      overlayUrl: `${overlayBase}/overlay/${encodeURIComponent(hostId)}`,
      budgets: room.specialBudgets,
      shared: rooms.shared.get(hostId) ?? [],
    };
  });

  app.get<{ Params: { hostId: string } }>('/api/arena/:hostId', async (request) =>
    rooms.get(request.params.hostId).view(),
  );

  app.post<{ Params: { hostId: string }; Body: { decisionId?: string } }>(
    '/api/approve/:hostId',
    async (request, reply) => {
      const { hostId } = request.params;
      if (!authorized(request, hostId))
        return reply.code(401).send({ error: 'Host login required.' });
      if (!request.body || typeof request.body.decisionId !== 'string')
        return reply.code(400).send({ error: 'A decision is required.' });
      const action = rooms.get(hostId).gate.getRequest(request.body.decisionId);
      if (hostId !== 'demo' && action?.action === 'rumble.start.collab') {
        const approvedMembers = action.payload.sessionParticipantIds;
        const current = [...(rooms.shared.get(hostId) ?? [])].sort();
        if (
          !Array.isArray(approvedMembers) ||
          JSON.stringify([...approvedMembers].sort()) !== JSON.stringify(current)
        ) {
          rooms.get(hostId).decline();
          return reply.code(409).send({ error: 'Shared Chat changed. Start a new challenge.' });
        }
      }
      const accepted = await rooms.get(hostId).approve(request.body.decisionId, hostId);
      return accepted
        ? { accepted }
        : reply.code(409).send({ error: 'This challenge expired or was already answered.' });
    },
  );

  app.post<{ Params: { hostId: string } }>('/api/decline/:hostId', async (request, reply) => {
    if (!authorized(request, request.params.hostId))
      return reply.code(401).send({ error: 'Host login required.' });
    rooms.get(request.params.hostId).decline();
    return { declined: true };
  });

  app.post<{ Params: { hostId: string }; Body: unknown }>(
    '/api/settings/:hostId',
    async (request, reply) => {
      const hostId = request.params.hostId;
      if (!authorized(request, hostId))
        return reply.code(401).send({ error: 'Host login required.' });
      if (!validSettings(request.body))
        return reply.code(400).send({ error: 'Check your channel lists, facts, and policy mode.' });
      rooms.get(hostId).configure(request.body);
      rooms.save(hostId);
      return { saved: true };
    },
  );

  app.post<{ Params: { hostId: string } }>('/api/oil/:hostId', async (request, reply) => {
    const hostId = request.params.hostId;
    if (!authorized(request, hostId))
      return reply.code(401).send({ error: 'Host login required.' });
    const fired = await rooms.get(hostId).fire(hostId, 'oil');
    return fired
      ? { fired }
      : reply.code(409).send({ error: 'Boiling Oil is available once, during Siege.' });
  });

  app.post<{ Params: { hostId: string } }>('/api/test/:hostId', async (request, reply) => {
    const { hostId } = request.params;
    if (!authorized(request, hostId))
      return reply.code(401).send({ error: 'Host login required.' });
    const profile = rooms.profiles.get(hostId);
    if (!profile) return reply.code(404).send({ error: 'Channel not connected.' });
    await rooms.raid(hostId, {
      channels: { host: profile, raider: demoChannels.raider },
      raiderLogin: 'pixelpilot',
      accountAgeDays: 300,
      hostFollowsRaider: true,
      viewers: 300,
      homeMembers: 20,
      simulated: true,
    });
    return rooms.get(hostId).view();
  });

  app.get<{ Querystring: { host?: string } }>('/api/network', async (request, reply) => {
    const hostId = request.query.host ?? 'demo';
    if (!authorized(request, hostId))
      return reply.code(401).send({ error: 'Host login required.' });
    const graph = rooms.graph();
    const edges = graph.edges.filter((edge) => edge.source === hostId || edge.target === hostId);
    const ids = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
    return { nodes: graph.nodes.filter((node) => ids.has(node.id)), edges };
  });
}
