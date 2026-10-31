import { describe, expect, it, vi } from 'vitest';
import { OAuthClient, OAuthStateStore, TokenSession } from '../src/auth.js';

describe('Twitch OAuth', () => {
  it('binds expiring, single-use state to the browser and requested role', () => {
    let now = 0;
    const store = new OAuthStateStore({ now: () => now, ttlMs: 100 });
    const state = store.issue({ browserId: 'browser', role: 'warlord', expectedUserId: 'raider' });
    expect(store.consume(state, 'attacker')).toBeNull();
    expect(store.consume(state, 'browser')).toMatchObject({
      role: 'warlord',
      expectedUserId: 'raider',
    });
    expect(store.consume(state, 'browser')).toBeNull();
    const second = store.issue({ browserId: 'browser', role: 'host' });
    now = 101;
    expect(store.consume(second, 'browser')).toBeNull();
  });

  it('builds a code flow and escapes state and scopes', () => {
    const client = new OAuthClient({
      clientId: 'client',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/auth/callback',
    });
    const url = new URL(
      client.authorizationUrl('opaque + state', ['user:read:chat', 'user:write:chat']),
    );
    expect(url.origin).toBe('https://id.twitch.tv');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('opaque + state');
    expect(url.searchParams.get('scope')).toBe('user:read:chat user:write:chat');
  });

  it('exchanges codes at the identity endpoint and validates identity', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 3600,
          scope: ['user:read:chat'],
          token_type: 'bearer',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          client_id: 'client',
          login: 'raider',
          user_id: '1',
          scopes: ['user:read:chat'],
          expires_in: 3599,
        }),
      );
    const client = new OAuthClient({
      clientId: 'client',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/auth/callback',
      fetch: fetcher,
      now: () => 1000,
    });
    const tokens = await client.exchange('code');
    expect(tokens).toMatchObject({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 3_601_000,
    });
    expect(String(fetcher.mock.calls[0]![0])).toBe('https://id.twitch.tv/oauth2/token');
    expect(String(fetcher.mock.calls[0]![1]?.body)).toContain('grant_type=authorization_code');
    expect(await client.validate(tokens.accessToken)).toMatchObject({
      userId: '1',
      login: 'raider',
    });
  });

  it('rejects a token validated for a different client', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        client_id: 'different',
        login: 'raider',
        user_id: '1',
        scopes: [],
        expires_in: 3600,
      }),
    );
    const client = new OAuthClient({
      clientId: 'client',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/auth/callback',
      fetch: fetcher,
    });
    await expect(client.validate('access')).rejects.toThrow('client');
  });

  it('coalesces concurrent refreshes so rotated refresh tokens are used once', async () => {
    const refreshed = {
      accessToken: 'fresh',
      refreshToken: 'rotated',
      expiresAt: 3_600_000,
      scopes: [],
    };
    const refresh = vi.fn().mockResolvedValue(refreshed);
    const session = new TokenSession(
      { accessToken: 'old', refreshToken: 'refresh', expiresAt: 10, scopes: [] },
      refresh,
      () => 100,
    );
    expect(
      await Promise.all([session.accessToken(), session.accessToken(), session.accessToken()]),
    ).toEqual(['fresh', 'fresh', 'fresh']);
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith('refresh');
    expect(await session.accessToken()).toBe('fresh');
    expect(refresh).toHaveBeenCalledOnce();
  });
});
