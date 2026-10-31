import { createServer } from 'node:net';
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { CallbackRelay } from '../relay.js';
import { begin, fixture } from './fixture.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected test port');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function relayFixture() {
  const port = await unusedPort();
  const redirectUri = `http://127.0.0.1:${port}/auth/twitch/callback`;
  const relay = new CallbackRelay('http://127.0.0.1:3000', redirectUri);
  cleanups.push(() => relay.stop());
  await relay.start();
  return { relay, redirectUri };
}

describe('Loopback OAuth callback relay', () => {
  it('forwards only OAuth fields to the fixed API callback without an open redirect', async () => {
    const f = await relayFixture();
    const response = await fetch(
      `${f.redirectUri}?state=browserState&code=oneUseCode&next=https://foreign.example`,
      { redirect: 'manual' },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'http://127.0.0.1:3000/auth/callback?state=browserState&code=oneUseCode',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await response.text()).not.toContain('oneUseCode');
  });

  it('exposes no other API paths and rejects writes, hostile Host headers, and repeated state', async () => {
    const f = await relayFixture();
    const origin = new URL(f.redirectUri).origin;
    expect((await fetch(`${origin}/api/demo`, { redirect: 'manual' })).status).toBe(404);
    expect((await fetch(f.redirectUri, { method: 'POST', redirect: 'manual' })).status).toBe(405);
    const hostile = await new Promise<number | undefined>((resolve, reject) => {
      const outgoing = request(
        f.redirectUri,
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
    expect((await fetch(`${f.redirectUri}?state=a&state=b`, { redirect: 'manual' })).status).toBe(
      400,
    );
  });

  it('closes idempotently and needs no listener when the callback is on the API origin', async () => {
    const f = await relayFixture();
    expect(f.relay.listening).toBe(true);
    await f.relay.stop();
    await f.relay.stop();
    expect(f.relay.listening).toBe(false);
    const direct = new CallbackRelay('http://localhost:3000');
    expect(await direct.start()).toBe(false);
    expect(direct.listening).toBe(false);
    await direct.stop();
  });

  it('preserves browser-bound OAuth state and exact exchange redirect across the relay', async () => {
    const port = await unusedPort();
    const redirectUri = `http://127.0.0.1:${port}/auth/twitch/callback`;
    const f = fixture({ baseUrl: 'http://127.0.0.1:3000', redirectUri, botUserId: undefined });
    cleanups.push(() => f.app.close());
    await f.service.startCallbackRelay();
    const flow = await begin(f, 'host');
    expect(new URL(String(flow.response.headers.location)).searchParams.get('redirect_uri')).toBe(
      redirectUri,
    );
    const response = await fetch(`${redirectUri}?state=${flow.state}&code=10:host`, {
      redirect: 'manual',
    });
    const target = new URL(response.headers.get('location') ?? '');
    expect(target.origin).toBe('http://127.0.0.1:3000');
    const missingCookie = await f.app.inject({ url: target.pathname + target.search });
    expect(missingCookie.statusCode).toBe(400);
    expect(f.fetcher).not.toHaveBeenCalled();
    const callback = await f.app.inject({
      url: target.pathname + target.search,
      headers: { cookie: flow.cookie },
    });
    expect(callback.statusCode).toBe(302);
    expect(f.service.status('10').hostConnected).toBe(true);
    const tokenRequest = f.fetcher.mock.calls.find(([input]) =>
      String(input).endsWith('/oauth2/token'),
    );
    expect(new URLSearchParams(String(tokenRequest?.[1]?.body)).get('redirect_uri')).toBe(
      redirectUri,
    );
    const replay = await f.app.inject({
      url: target.pathname + target.search,
      headers: { cookie: flow.cookie },
    });
    expect(replay.statusCode).toBe(400);
  });

  it('supports a same-origin callback path without changing the dashboard destination', async () => {
    const redirectUri = 'http://localhost:3000/auth/twitch/callback';
    const f = fixture({ redirectUri });
    cleanups.push(() => f.app.close());
    const flow = await begin(f, 'host');
    const callback = await f.app.inject({
      url: `/auth/twitch/callback?state=${flow.state}&code=10:host`,
      headers: { cookie: flow.cookie },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('http://localhost:5174/?host=10');
  });
});
