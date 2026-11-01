import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductionAccess, type AccessLimits } from '../src/services/access.js';

const origin = 'https://raids.example';
const active: FastifyInstance[] = [];

function fixture(limits: Partial<AccessLimits> = {}) {
  let now = 0;
  let effects = 0;
  let allocations = 0;
  let fail = false;
  const app = Fastify();
  const access = new ProductionAccess({ origin, now: () => now, limits });
  access.register(app);
  app.get('/api/read', async () => ({ read: true }));
  app.get('/ws/demo', async () => ({ read: true }));
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/auth/host', async () => ({ allocated: ++allocations }));
  app.get('/auth/callback', async () => ({ callback: true }));
  app.post('/api/demo', async (_request, reply) => {
    if (fail) return reply.code(503).send({ error: 'Preparation unavailable.' });
    return { changed: ++effects };
  });
  app.post('/api/demo/reset', async () => ({ changed: ++effects }));
  for (const action of ['approve', 'decline', 'oil', 'test', 'warlord'])
    app.post(`/api/${action}/:hostId`, async () => ({ changed: ++effects }));
  app.post<{ Params: { hostId: string } }>('/api/settings/:hostId', async (request, reply) => {
    if (request.params.hostId !== 'demo' && request.headers.cookie !== 'rrsession=host')
      return reply.code(401).send({ error: 'Host login required.' });
    return { changed: ++effects };
  });
  const value = {
    app,
    access,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    failStart: () => {
      fail = true;
    },
    recover: () => {
      fail = false;
    },
    effects: () => effects,
    allocations: () => allocations,
  };
  active.push(app);
  return value;
}

function cookie(headers: Record<string, unknown>): string {
  const header = headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' ? value.split(';')[0]! : '';
}

afterEach(async () => {
  await Promise.all(active.splice(0).map((app) => app.close()));
});

describe('production request admission', () => {
  it.each([undefined, 'null', 'https://foreign.example'])(
    'refuses mutation Origin %s',
    async (source) => {
      const f = fixture();
      const response = await f.app.inject({
        method: 'POST',
        url: '/api/demo',
        payload: {},
        headers: source === undefined ? {} : { origin: source },
      });
      expect(response.statusCode).toBe(403);
      expect(f.effects()).toBe(0);
    },
  );

  it('keeps OAuth callbacks accessible and private without an Origin', async () => {
    const f = fixture();
    const response = await f.app.inject('/auth/callback?state=test&code=test');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    const api = await f.app.inject('/api/read');
    expect(api.headers['cache-control']).toBe('private, no-store');
  });

  it('allows native OBS reads but rejects a foreign present WebSocket Origin', async () => {
    const f = fixture();
    expect((await f.app.inject('/ws/demo')).statusCode).toBe(200);
    expect((await f.app.inject({ url: '/ws/demo', headers: { origin } })).statusCode).toBe(200);
    expect((await f.app.inject({ url: '/ws/demo', headers: { origin: 'null' } })).statusCode).toBe(
      403,
    );
    expect(
      (await f.app.inject({ url: '/ws/demo', headers: { origin: 'https://foreign.example' } }))
        .statusCode,
    ).toBe(403);
  });

  it('rate-limits OAuth before allocation without blocking existing callbacks', async () => {
    const f = fixture({ authPerIp: 2, authGlobal: 3 });
    for (let index = 0; index < 2; index++)
      expect(
        (await f.app.inject({ url: '/auth/host', remoteAddress: '192.0.2.1' })).statusCode,
      ).toBe(200);
    expect((await f.app.inject({ url: '/auth/host', remoteAddress: '192.0.2.1' })).statusCode).toBe(
      429,
    );
    expect((await f.app.inject({ url: '/auth/host', remoteAddress: '192.0.2.2' })).statusCode).toBe(
      200,
    );
    expect((await f.app.inject({ url: '/auth/host', remoteAddress: '192.0.2.3' })).statusCode).toBe(
      429,
    );
    expect(f.allocations()).toBe(3);
    expect((await f.app.inject('/auth/callback?state=existing')).statusCode).toBe(200);
    f.advance(60_000);
    expect((await f.app.inject('/auth/host')).statusCode).toBe(200);
  });

  it('bounds client tracking without resetting the global HTTP budget', async () => {
    const f = fixture({ maxClients: 2, requestsPerIp: 100, requestsGlobal: 5 });
    for (let index = 0; index < 5; index++)
      expect(
        (await f.app.inject({ url: '/api/read', remoteAddress: `192.0.2.${index}` })).statusCode,
      ).toBe(200);
    expect(f.access.clientCount).toBe(2);
    expect((await f.app.inject({ url: '/api/read', remoteAddress: '192.0.2.99' })).statusCode).toBe(
      429,
    );
    expect((await f.app.inject('/health')).statusCode).toBe(200);
    f.advance(60_000);
    expect((await f.app.inject('/api/read')).statusCode).toBe(200);
  });

  it('limits one client while allowing another client within the global budget', async () => {
    const f = fixture({ requestsPerIp: 2 });
    for (let index = 0; index < 2; index++)
      expect(
        (await f.app.inject({ url: '/api/read', remoteAddress: '192.0.2.1' })).statusCode,
      ).toBe(200);
    const limited = await f.app.inject({ url: '/api/read', remoteAddress: '192.0.2.1' });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await f.app.inject({ url: '/api/read', remoteAddress: '192.0.2.2' })).statusCode).toBe(
      200,
    );
  });
});

describe('shared hosted demo lease', () => {
  it('gives one anonymous browser a secure lease while other browsers can only read', async () => {
    const f = fixture();
    const started = await f.app.inject({
      method: 'POST',
      url: '/api/demo',
      headers: { origin },
      payload: {},
    });
    expect(started.statusCode).toBe(200);
    const owner = cookie(started.headers);
    expect(owner).toMatch(/^__Host-rrpreview=[A-Za-z0-9_-]{43}$/);
    expect(started.headers['set-cookie']).toContain('HttpOnly');
    expect(started.headers['set-cookie']).toContain('Secure');
    expect(started.headers['set-cookie']).toContain('SameSite=Strict');
    expect(started.headers['set-cookie']).toContain('Max-Age=240');
    expect(started.headers['set-cookie']).not.toContain('Domain=');
    expect((await f.app.inject('/api/read')).statusCode).toBe(200);
    f.advance(1000);
    for (const url of [
      '/api/demo',
      '/api/demo/reset',
      '/api/approve/demo',
      '/api/decline/demo',
      '/api/oil/demo',
      '/api/warlord/demo',
    ]) {
      const response = await f.app.inject({
        method: 'POST',
        url,
        headers: { origin },
        payload: {},
      });
      expect(response.statusCode).toBe(409);
      expect(response.body).toContain('shared demo');
    }
    expect(f.effects()).toBe(1);
    for (const action of ['approve', 'decline', 'oil', 'warlord']) {
      f.advance(1000);
      const response = await f.app.inject({
        method: 'POST',
        url: `/api/${action}/demo`,
        headers: { origin, cookie: owner },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it('reserves a single lease atomically for concurrent launches', async () => {
    const f = fixture();
    const responses = await Promise.all(
      ['192.0.2.1', '192.0.2.2'].map((remoteAddress) =>
        f.app.inject({
          method: 'POST',
          url: '/api/demo',
          headers: { origin },
          payload: {},
          remoteAddress,
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(f.effects()).toBe(1);
  });

  it('keeps launch, reset and control cooldowns reserved before handlers run', async () => {
    const f = fixture();
    const first = await f.app.inject({
      method: 'POST',
      url: '/api/demo',
      headers: { origin },
      payload: {},
    });
    const headers = { origin, cookie: cookie(first.headers) };
    f.advance(1000);
    expect(
      (await f.app.inject({ method: 'POST', url: '/api/demo/reset', headers })).statusCode,
    ).toBe(200);
    f.advance(300);
    expect(
      (await f.app.inject({ method: 'POST', url: '/api/demo/reset', headers })).statusCode,
    ).toBe(429);
    expect(
      (await f.app.inject({ method: 'POST', url: '/api/demo', headers, payload: {} })).statusCode,
    ).toBe(429);
    f.advance(3700);
    expect(
      (await f.app.inject({ method: 'POST', url: '/api/demo', headers, payload: {} })).statusCode,
    ).toBe(200);
    const simultaneous = await Promise.all(
      ['/api/oil/demo', '/api/warlord/demo'].map((url) =>
        f.app.inject({ method: 'POST', url, headers }),
      ),
    );
    expect(simultaneous.every((response) => response.statusCode === 429)).toBe(true);
  });

  it('expires the owner without renewing the lease on reads or control attempts', async () => {
    const f = fixture();
    const first = await f.app.inject({
      method: 'POST',
      url: '/api/demo',
      headers: { origin },
      payload: {},
    });
    const oldCookie = cookie(first.headers);
    f.advance(239_000);
    await f.app.inject({ url: '/api/read', headers: { cookie: oldCookie } });
    f.advance(1000);
    const next = await f.app.inject({
      method: 'POST',
      url: '/api/demo',
      headers: { origin },
      payload: {},
    });
    expect(next.statusCode).toBe(200);
    expect(cookie(next.headers)).not.toBe(oldCookie);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/demo/reset',
          headers: { origin, cookie: oldCookie },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('releases a newly reserved lease after a failed start', async () => {
    const f = fixture();
    f.failStart();
    expect(
      (await f.app.inject({ method: 'POST', url: '/api/demo', headers: { origin }, payload: {} }))
        .statusCode,
    ).toBe(503);
    f.recover();
    f.advance(5000);
    expect(
      (await f.app.inject({ method: 'POST', url: '/api/demo', headers: { origin }, payload: {} }))
        .statusCode,
    ).toBe(200);
  });

  it('does not let a late failed launch release a newer browser lease', async () => {
    let now = 0;
    let calls = 0;
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const app = Fastify();
    active.push(app);
    new ProductionAccess({ origin, now: () => now }).register(app);
    app.post('/api/demo', async (_request, reply) => {
      if (++calls === 1) {
        started();
        await waiting;
        return reply.code(503).send({ error: 'Old start failed.' });
      }
      return { active: true };
    });
    app.post('/api/demo/reset', async () => ({ reset: true }));
    const first = app.inject({
      method: 'POST',
      url: '/api/demo',
      headers: { origin },
      payload: {},
    });
    await entered;
    now = 240_000;
    const second = await app.inject({
      method: 'POST',
      url: '/api/demo',
      headers: { origin },
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    release();
    expect((await first).statusCode).toBe(503);
    now += 1000;
    expect(
      (await app.inject({ method: 'POST', url: '/api/demo/reset', headers: { origin } }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/demo/reset',
          headers: { origin, cookie: cookie(second.headers) },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('freezes shared settings, encoded aliases, trust persistence and alternate start paths', async () => {
    const f = fixture();
    const first = await f.app.inject({
      method: 'POST',
      url: '/api/demo',
      headers: { origin },
      payload: {},
    });
    const headers = { origin, cookie: cookie(first.headers) };
    f.advance(1000);
    for (const url of ['/api/settings/demo', '/api/settings/%64emo', '/api/test/demo'])
      expect((await f.app.inject({ method: 'POST', url, headers, payload: {} })).statusCode).toBe(
        403,
      );
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/approve/demo',
          headers,
          payload: { trustNextTime: true },
        })
      ).statusCode,
    ).toBe(403);
    expect(f.effects()).toBe(1);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/settings/123',
          headers: { origin, cookie: 'rrsession=host' },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/settings/123',
          headers: { origin },
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
  });

  it.each([
    { speed: 30 },
    { scenario: 'unknown' },
    { scenario: 'normal', facts: ['injected'] },
    [],
  ])('rejects non-preset public launch %j before execution', async (payload) => {
    const f = fixture();
    const response = await f.app.inject({
      method: 'POST',
      url: '/api/demo',
      headers: { origin },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(f.effects()).toBe(0);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
