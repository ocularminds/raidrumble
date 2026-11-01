import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { begin, fixture, login } from './fixture.js';

function request(cookie: string, origin?: string): FastifyRequest {
  return { method: 'POST', headers: { cookie, ...(origin ? { origin } : {}) } } as FastifyRequest;
}

describe('Live Twitch authentication', () => {
  it('keeps judge mode usable when no Twitch credentials are configured', async () => {
    const f = fixture({ clientSecret: undefined });
    expect((await f.app.inject({ url: '/auth/host' })).statusCode).toBe(503);
    expect(f.service.status('demo')).toMatchObject({
      configured: false,
      hostConnected: false,
      botConnected: false,
    });
    expect(f.fetcher).not.toHaveBeenCalled();
    await f.app.close();
  });

  it('authenticates a host via browser-bound state and an HttpOnly cookie', async () => {
    const f = fixture();
    const flow = await begin(f, 'host');
    expect(flow.response.statusCode).toBe(302);
    expect(flow.response.headers['set-cookie']).toContain('HttpOnly');
    expect(flow.response.headers['set-cookie']).toContain('SameSite=Lax');
    const response = await f.app.inject({
      url: `/auth/callback?state=${flow.state}&code=10:host`,
      headers: { cookie: flow.cookie },
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('http://localhost:5174/?host=10');
    expect(f.onHost).toHaveBeenCalledWith(
      expect.objectContaining({ id: '10', category: 'Gardening' }),
    );
    expect(f.service.authorizeHost(request(flow.cookie), '10')).toBe(true);
    expect(f.service.authorizeHost(request(flow.cookie), '30')).toBe(false);
    expect(f.service.status('10')).toMatchObject({
      configured: true,
      hostConnected: true,
      botConnected: false,
    });
    await f.app.close();
  });

  it('refreshes the HTTPS cookie only after successful authentication', async () => {
    const f = fixture({ baseUrl: 'https://arena.example', dashboardUrl: 'https://arena.example' });
    const flow = await begin(f, 'host');
    expect(flow.response.headers['set-cookie']).toContain('Max-Age=600; Secure');
    f.setNow(1_798_000_000_000 + 9 * 60_000);
    const success = await f.app.inject({
      url: `/auth/callback?state=${flow.state}&code=10:host`,
      headers: { cookie: flow.cookie },
    });
    expect(success.statusCode).toBe(302);
    expect(success.headers['set-cookie']).toBe(
      `${flow.cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure`,
    );
    expect(success.headers.location).toBe('https://arena.example/?host=10');
    await f.app.close();
  });

  it('does not extend an empty browser session when OAuth is restarted near expiry', async () => {
    const f = fixture();
    const original = await begin(f, 'host');
    f.setNow(1_798_000_000_000 + 590_000);
    const retry = await begin(f, 'host', original.cookie);
    expect(retry.response.statusCode).toBe(302);
    expect(retry.response.headers['set-cookie']).toBeUndefined();
    f.setNow(1_798_000_000_000 + 600_000);
    const expired = await f.app.inject({
      url: `/auth/callback?state=${retry.state}&code=10:host`,
      headers: { cookie: original.cookie },
    });
    expect(expired.statusCode).toBe(400);
    expect(expired.headers['set-cookie']).toBeUndefined();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.service.status('10').hostConnected).toBe(false);
    await f.app.close();
  });

  it('connects a host before a bot is configured and refuses an unbound bot login', async () => {
    const f = fixture({ botUserId: undefined });
    const host = await login(f, 'host', '10');
    expect(host.response.statusCode).toBe(302);
    expect(f.service.status('10')).toMatchObject({
      configured: true,
      hostConnected: true,
      botConnected: false,
    });
    const count = f.fetcher.mock.calls.length;
    const bot = await begin(f, 'bot', host.cookie);
    expect(bot.response.statusCode).toBe(503);
    expect(bot.response.body).toContain('bot account');
    expect(f.fetcher.mock.calls).toHaveLength(count);
    await f.app.close();
  });

  it('rejects mismatched browsers and replayed callbacks before credential exchange', async () => {
    const f = fixture();
    const flow = await begin(f, 'host');
    const wrongBrowser = await f.app.inject({
      url: `/auth/callback?state=${flow.state}&code=10:host`,
      headers: { cookie: 'rrsession=attacker' },
    });
    expect(wrongBrowser.statusCode).toBe(400);
    expect(f.fetcher).not.toHaveBeenCalled();
    const success = await f.app.inject({
      url: `/auth/callback?state=${flow.state}&code=10:host`,
      headers: { cookie: flow.cookie },
    });
    expect(success.statusCode).toBe(302);
    const replay = await f.app.inject({
      url: `/auth/callback?state=${flow.state}&code=10:host`,
      headers: { cookie: flow.cookie },
    });
    expect(replay.statusCode).toBe(400);
    await f.app.close();
  });

  it('requires host authentication and the configured identity to connect the bot', async () => {
    const f = fixture();
    expect((await f.app.inject({ url: '/auth/bot' })).statusCode).toBe(401);
    const host = await login(f, 'host', '10');
    const wrong = await login(f, 'bot', '99', host.cookie);
    expect(wrong.response.statusCode).toBe(403);
    expect(f.service.status('10').botConnected).toBe(false);
    const bot = await login(f, 'bot', '20', host.cookie);
    expect(bot.response.statusCode).toBe(302);
    expect(f.service.status('10').botConnected).toBe(true);
    expect(f.service.userId(request(host.cookie))).toBe('10');
    await f.app.close();
  });

  it('binds Warlord login to a server-issued match token and its raiding identity', async () => {
    const f = fixture();
    const link = f.service.warlordLink('10', '30', 'match');
    expect(link.url).toContain('/warlord/');
    expect((await f.app.inject({ url: '/auth/warlord?token=forged' })).statusCode).toBe(404);
    const wrong = await login(f, 'warlord', '99', undefined, `?token=${link.token}`);
    expect(wrong.response.statusCode).toBe(403);
    const valid = await login(f, 'warlord', '30', undefined, `?token=${link.token}`);
    expect(valid.response.statusCode).toBe(302);
    expect(valid.response.headers.location).toBe(link.url);
    expect(f.service.authorizeWarlord(request(valid.cookie), link.token)).toBe(true);
    expect(f.service.userId(request(valid.cookie), 'warlord')).toBe('30');
    expect(f.service.warlord(link.token)).toMatchObject({
      hostId: '10',
      raiderId: '30',
      matchId: 'match',
    });
    f.service.clearMatch('match');
    expect(f.service.authorizeWarlord(request(valid.cookie), link.token)).toBe(false);
    await f.app.close();
  });

  it('rejects hostile origins on controls and expires browser authentication', async () => {
    const f = fixture();
    const host = await login(f, 'host', '10');
    expect(f.service.authorizeHost(request(host.cookie, 'http://attacker.invalid'), '10')).toBe(
      false,
    );
    expect(f.service.authorizeHost(request(host.cookie, 'http://localhost:5174'), '10')).toBe(true);
    f.setNow(1_798_000_000_000 + 13 * 3_600_000);
    expect(f.service.authorizeHost(request(host.cookie), '10')).toBe(false);
    await f.app.close();
  });

  it('returns generic errors without reflecting credential-provider failures', async () => {
    const f = fixture();
    const flow = await begin(f, 'host');
    f.fetcher.mockRejectedValueOnce(new Error('credential-secret'));
    const response = await f.app.inject({
      url: `/auth/callback?state=${flow.state}&code=10:host`,
      headers: { cookie: flow.cookie },
    });
    expect(response.statusCode).toBe(502);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.body).not.toContain('credential-secret');
    expect(response.headers['cache-control']).toBe('no-store');
    await f.app.close();
  });
});
