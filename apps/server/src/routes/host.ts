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
      approval: room.approval(),
      settings: rooms.primary(hostId).settings(),
      decisions: room.gate
        .listRecords()
        .filter((decision) => decision.action !== 'content.render')
        .slice(-40)
        .reverse(),
      twitch: live.status(hostId),
      overlayUrl: `${overlayBase}/overlay/${encodeURIComponent(hostId)}`,
      budgets: room.specialBudgets,
      shared: rooms.shared.get(hostId) ?? [],
      sharedChannels: live.sharedChannels(hostId),
    };
  });

  app.get<{ Params: { hostId: string } }>('/api/arena/:hostId', async (request) =>
    rooms.get(request.params.hostId).view(),
  );

  app.post<{ Params: { hostId: string }; Body: { decisionId?: string; trustNextTime?: boolean } }>(
    '/api/approve/:hostId',
    async (request, reply) => {
      const { hostId } = request.params;
      if (!authorized(request, hostId))
        return reply.code(401).send({ error: 'Host login required.' });
      if (!request.body || typeof request.body.decisionId !== 'string')
        return reply.code(400).send({ error: 'A decision is required.' });
      if (
        request.body.trustNextTime !== undefined &&
        typeof request.body.trustNextTime !== 'boolean'
      )
        return reply.code(400).send({ error: 'Choose whether to trust this community next time.' });
      const room = rooms.get(hostId);
      const primary = rooms.primary(hostId);
      const action = room.gate.getRequest(request.body.decisionId);
      if (hostId !== 'demo' && action?.action === 'rumble.start.collab') {
        const approvedMembers = action.payload.sessionParticipantIds;
        const current = [...(rooms.shared.get(hostId) ?? [])].sort();
        if (
          !Array.isArray(approvedMembers) ||
          JSON.stringify([...approvedMembers].sort()) !== JSON.stringify(current)
        ) {
          room.decline();
          return reply.code(409).send({ error: 'Shared Chat changed. Start a new challenge.' });
        }
      }
      const originalId = room.view().pending?.decisionId;
      const trust = request.body.trustNextTime === true && room === primary;
      const accepted = await room.approve(request.body.decisionId, hostId, trust);
      if (accepted) {
        if (trust) rooms.save(hostId);
        return { accepted };
      }
      const pending = room.view().pending;
      if (pending && originalId === request.body.decisionId && room.approval())
        return reply.code(202).send({ accepted: false, pending, approval: room.approval() });
      return reply.code(409).send({ error: 'This challenge expired or was already answered.' });
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
      rooms.primary(hostId).configure(request.body);
      if (rooms.get(hostId) !== rooms.primary(hostId)) rooms.get(hostId).configure(request.body);
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

  app.post<{ Params: { hostId: string }; Body: { realChat?: boolean } | undefined }>(
    '/api/test/:hostId',
    async (request, reply) => {
      const { hostId } = request.params;
      if (!authorized(request, hostId))
        return reply.code(401).send({ error: 'Host login required.' });
      if (
        request.body !== undefined &&
        (!request.body ||
          typeof request.body !== 'object' ||
          Array.isArray(request.body) ||
          (request.body.realChat !== undefined && typeof request.body.realChat !== 'boolean'))
      )
        return reply.code(400).send({ error: 'Choose a valid test raid mode.' });
      if (request.body?.realChat === true && hostId === 'demo')
        return reply
          .code(403)
          .send({ error: 'Connect your Twitch channel to practice with real chat.' });
      const profile = rooms.profiles.get(hostId);
      if (!profile) return reply.code(404).send({ error: 'Channel not connected.' });
      if (request.body?.realChat === true) {
        try {
          return (await rooms.practice(hostId)).view();
        } catch {
          return reply
            .code(409)
            .send({ error: 'Finish or cancel the current challenge before practicing.' });
        }
      }
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
    },
  );

  app.post<{ Params: { hostId: string }; Body: unknown }>(
    '/api/practice/:hostId/exit',
    async (request, reply) => {
      const { hostId } = request.params;
      if (!authorized(request, hostId))
        return reply.code(401).send({ error: 'Host login required.' });
      if (hostId === 'demo')
        return reply
          .code(403)
          .send({ error: 'Real-chat practice belongs to a connected channel.' });
      if (
        request.body !== undefined &&
        (!request.body ||
          typeof request.body !== 'object' ||
          Array.isArray(request.body) ||
          Object.keys(request.body).length)
      )
        return reply.code(400).send({ error: 'This action does not take any settings.' });
      try {
        await rooms.endPractice(hostId);
        return { exited: true };
      } catch {
        return reply.code(409).send({ error: 'Practice could not be closed. Try again.' });
      }
    },
  );

  app.get<{ Querystring: { host?: string } }>('/api/network', async (request, reply) => {
    const hostId = request.query.host ?? 'demo';
    if (!authorized(request, hostId))
      return reply.code(401).send({ error: 'Host login required.' });
    const graph = rooms.graph();
    const edges = graph.edges.filter((edge) => edge.source === hostId || edge.target === hostId);
    const ids = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
    const names = new Map(live.sharedChannels(hostId).map((channel) => [channel.id, channel.name]));
    return {
      nodes: graph.nodes
        .filter((node) => ids.has(node.id))
        .map((node) => ({ ...node, name: names.get(node.id) ?? node.name })),
      edges,
    };
  });
}
