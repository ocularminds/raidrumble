import { createServer, request, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { callbackMiddleware } from '../callback.js';
import { begin, fixture } from '../../server/src/live/test/fixture.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

async function dashboard() {
  const server = createServer();
  cleanups.push(() => close(server));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected test address');
  const origin = `http://localhost:${address.port}`;
  const middleware = callbackMiddleware('http://localhost:3000', origin);
  server.on('request', (req, res) => middleware(req, res, () => res.end('Dashboard route')));
  return { origin, port: address.port };
}

describe('Dashboard OAuth callback forwarding', () => {
  it.each(['/auth/callback', '/auth/twitch/callback'])(
    'redirects only GET %s to the fixed API without contacting an upstream',
    async (path) => {
      const f = await dashboard();
      const response = await fetch(
        `${f.origin}${path}?code=singleUse&state=bound&next=https://foreign.example`,
        { redirect: 'manual' },
      );
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/auth/callback?state=bound&code=singleUse',
      );
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(await response.text()).not.toContain('singleUse');
      expect(
        (await fetch(`${f.origin}${path}`, { method: 'POST', redirect: 'manual' })).status,
      ).toBe(405);
    },
  );

  it('leaves all other routes alone and rejects a hostile Host or duplicate OAuth fields', async () => {
    const f = await dashboard();
    for (const path of ['/auth/host', '/api/host/10', '/auth/callback/extra']) {
      const response = await fetch(f.origin + path, { redirect: 'manual' });
      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
    }
    expect(
      (await fetch(`${f.origin}/auth/callback?state=a&state=b`, { redirect: 'manual' })).status,
    ).toBe(400);
    const hostile = await new Promise<number | undefined>((resolve, reject) => {
      const outgoing = request(
        `${f.origin}/auth/callback?code=singleUse`,
        { headers: { Host: 'foreign.example' } },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });
    expect(hostile).toBe(400);
  });

  it('does not infer or proxy an external callback destination', () => {
    expect(() => callbackMiddleware('https://api.example', 'http://localhost:5174')).toThrow();
    expect(() => callbackMiddleware('http://localhost:3000', 'https://foreign.example')).toThrow();
    expect(() => callbackMiddleware('http://localhost:3000', 'http://0.0.0.0:5174')).toThrow();
    expect(() => callbackMiddleware('http://localhost:3000', 'invalidPrivateValue')).toThrow(
      'Dashboard callback forwarding requires distinct HTTP loopback origins',
    );
  });

  it('preserves the original dashboard redirect URI and browser state without binding its port', async () => {
    const page = await dashboard();
    const redirectUri = `${page.origin}/auth/twitch/callback`;
    const f = fixture({ dashboardUrl: page.origin, redirectUri });
    cleanups.push(() => f.app.close());
    expect(await f.service.startCallbackRelay()).toBe(false);
    const flow = await begin(f, 'host');
    expect(new URL(String(flow.response.headers.location)).searchParams.get('redirect_uri')).toBe(
      redirectUri,
    );
    const response = await fetch(`${redirectUri}?state=${flow.state}&code=10:host`, {
      redirect: 'manual',
    });
    const target = new URL(response.headers.get('location') ?? '');
    const missingCookie = await f.app.inject({ url: target.pathname + target.search });
    expect(missingCookie.statusCode).toBe(400);
    expect(f.fetcher).not.toHaveBeenCalled();
    const callback = await f.app.inject({
      url: target.pathname + target.search,
      headers: { cookie: flow.cookie },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(`${page.origin}/?host=10`);
    const tokenRequest = f.fetcher.mock.calls.find(([input]) =>
      String(input).endsWith('/oauth2/token'),
    );
    expect(new URLSearchParams(String(tokenRequest?.[1]?.body)).get('redirect_uri')).toBe(
      redirectUri,
    );
    expect(f.service.status('10').hostConnected).toBe(true);
  });
});
