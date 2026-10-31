import type { FastifyInstance } from 'fastify';
import type { Scenario } from '../model.js';
import type { Rooms } from '../services/rooms.js';

const scenarios: readonly Scenario[] = ['normal', 'stranger-raid', 'hate-raid', 'collab'];

export function registerDemo(app: FastifyInstance, rooms: Rooms): void {
  app.post<{ Body: { scenario?: Scenario; speed?: number } }>(
    '/api/demo',
    async (request, reply) => {
      const scenario = request.body?.scenario ?? 'normal';
      const speed = request.body?.speed ?? 1;
      if (!scenarios.includes(scenario) || !Number.isFinite(speed) || speed < 1 || speed > 30)
        return reply
          .code(400)
          .send({ error: 'Choose a supported scenario and a speed from 1 to 30.' });
      try {
        const room = await rooms.demo(scenario, speed);
        return room.view();
      } catch (error) {
        return reply
          .code(409)
          .send({ error: error instanceof Error ? error.message : 'Unable to start practice.' });
      }
    },
  );

  app.post('/api/demo/reset', async () => {
    rooms.get('demo').reset();
    return { reset: true };
  });
}
