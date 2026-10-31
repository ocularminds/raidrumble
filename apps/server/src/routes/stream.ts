import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { StreamActions, StreamError, type StreamLive } from '../services/stream.js';
import type { Rooms } from '../services/rooms.js';

interface StreamRoutes {
  rooms: Rooms;
  live: StreamLive;
  actions: StreamActions;
}

/** HTTP authentication stays here; all proposed mutations are held by StreamActions. */
export function registerStream(app: FastifyInstance, { live, actions }: StreamRoutes): void {
  function controller(request: FastifyRequest<{ Params: { token: string } }>) {
    const value = actions.controller(request.params.token);
    if (!value) throw new StreamError(404, 'This Warlord link is invalid or expired.');
    const match = value.room.view().match;
    const active = match?.status === 'playing' && match.round?.id === 'siege';
    const available = active && value.room.specialBudgets?.ram === 1;
    return {
      ...value,
      active,
      available,
      authorized: value.simulated || live.authorizeWarlord(request, request.params.token),
    };
  }

  app.get<{ Params: { token: string } }>('/api/warlord/:token', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const value = controller(request);
      return {
        authorized: value.authorized,
        active: value.active,
        available: value.available,
        loginUrl: value.loginUrl,
        raiderName: value.room.view().raiderName,
        simulated: value.simulated,
        matchId: value.room.matchId,
      };
    } catch (error) {
      return failure(reply, error);
    }
  });

  app.post<{ Params: { token: string } }>('/api/warlord/:token', async (request, reply) => {
    try {
      const value = controller(request);
      if (!value.authorized)
        return reply.code(401).send({ error: 'Sign in as the raiding streamer first.' });
      if (!value.available || !(await value.room.fire(value.actorId, 'ram')))
        return reply.code(409).send({ error: 'Battering Ram is available once, during Siege.' });
      return { fired: true };
    } catch (error) {
      return failure(reply, error);
    }
  });

  app.get<{ Params: { hostId: string } }>('/api/rewards/:hostId', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const hostId = request.params.hostId;
    if (hostId !== 'demo' && !live.authorizeHost(request, hostId))
      return reply.code(401).send({ error: 'Host login required.' });
    return actions.rewardStatus(hostId);
  });

  app.post<{ Params: { hostId: string } }>('/api/rewards/:hostId', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const hostId = request.params.hostId;
    if (hostId === 'demo' || !live.authorizeHost(request, hostId))
      return reply.code(401).send({ error: 'Host login required.' });
    try {
      return await actions.prepareReward(hostId);
    } catch (error) {
      return failure(reply, error);
    }
  });

  app.post<{ Params: { hostId: string }; Body: { decisionId?: unknown } }>(
    '/api/rewards/:hostId/approve',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const hostId = request.params.hostId;
      if (hostId === 'demo' || !live.authorizeHost(request, hostId))
        return reply.code(401).send({ error: 'Host login required.' });
      if (typeof request.body?.decisionId !== 'string')
        return reply.code(400).send({ error: 'Choose a pending reward setup decision.' });
      try {
        const result = await actions.approveReward(
          hostId,
          live.userId(request) ?? '',
          request.body.decisionId,
        );
        return result.configured ? result : reply.code(202).send(result);
      } catch (error) {
        return failure(reply, error);
      }
    },
  );

  app.post<{ Params: { hostId: string }; Body: { peerId?: unknown } }>(
    '/api/collab/:hostId',
    async (request, reply) => {
      const hostId = request.params.hostId;
      if (hostId === 'demo' || !live.authorizeHost(request, hostId))
        return reply.code(401).send({ error: 'Host login required.' });
      const peerId = request.body?.peerId;
      if (peerId !== undefined && typeof peerId !== 'string')
        return reply.code(400).send({ error: 'Choose a Shared Chat participant.' });
      try {
        return await actions.collab(hostId, peerId);
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
}

function failure(reply: FastifyReply, error: unknown) {
  return error instanceof StreamError
    ? reply.code(error.statusCode).send({ error: error.message })
    : reply.code(500).send({ error: 'The stream action could not be completed.' });
}
