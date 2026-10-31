import { describe, expect, it } from 'vitest';
import { resolveCallback, resolveTwitchConfig } from '../config.js';

const baseUrl = 'http://localhost:3000';

describe('Twitch runtime configuration', () => {
  it('prefers canonical credentials and does not infer a bot identity', () => {
    const config = resolveTwitchConfig(
      {
        TWITCH_CLIENT_ID: 'canonical',
        TWITCH_CLIENT_SECRET: 'canonicalSecret',
        TWITCH_AUTH_CLIENT: 'alias',
        TWITCH_AUTH_SECRET: 'aliasSecret',
      },
      baseUrl,
    );
    expect(config).toEqual({
      clientId: 'canonical',
      clientSecret: 'canonicalSecret',
      botUserId: '',
      redirectUri: 'http://localhost:3000/auth/callback',
    });
  });

  it('uses supplied aliases when canonical settings are absent or blank', () => {
    expect(
      resolveTwitchConfig(
        {
          TWITCH_CLIENT_ID: ' ',
          TWITCH_AUTH_CLIENT: ' alias ',
          TWITCH_AUTH_SECRET: 'aliasSecret',
          TWITCH_BOT_USER_ID: '20',
          TWITCH_AUTH_URL: 'http://localhost:5781/auth/twitch/callback',
        },
        baseUrl,
      ),
    ).toEqual({
      clientId: 'alias',
      clientSecret: 'aliasSecret',
      botUserId: '20',
      redirectUri: 'http://localhost:5781/auth/twitch/callback',
    });
  });

  it('plans a listener only for an explicit alternate loopback port', () => {
    expect(resolveCallback(baseUrl, 'http://localhost:5781/auth/twitch/callback')).toEqual({
      redirectUri: 'http://localhost:5781/auth/twitch/callback',
      path: '/auth/twitch/callback',
      relay: {
        host: '127.0.0.1',
        port: 5781,
        authority: 'localhost:5781',
        target: 'http://localhost:3000/auth/callback',
      },
    });
    expect(resolveCallback(baseUrl).relay).toBeUndefined();
    expect(
      resolveCallback('https://arena.example', 'https://arena.example/auth/twitch/callback').relay,
    ).toBeUndefined();
  });

  it.each(['/auth/callback', '/auth/twitch/callback'])(
    'recognizes the configured dashboard callback %s without a competing listener',
    (path) => {
      const dashboardUrl = 'http://localhost:5174';
      const config = resolveCallback(baseUrl, dashboardUrl + path, dashboardUrl);
      expect(config).toEqual({ redirectUri: dashboardUrl + path, path, dashboard: true });
      expect(
        resolveTwitchConfig({ TWITCH_AUTH_URL: dashboardUrl + path }, baseUrl).redirectUri,
      ).toBe(dashboardUrl + path);
    },
  );

  it('uses an explicit dashboard origin rather than recognizing a port by convention', () => {
    const dashboardUrl = 'http://127.0.0.1:5199';
    expect(
      resolveCallback(baseUrl, dashboardUrl + '/auth/callback', dashboardUrl).relay,
    ).toBeUndefined();
    expect(
      resolveCallback(baseUrl, 'http://localhost:5174/auth/callback', dashboardUrl).relay?.port,
    ).toBe(5174);
    expect(
      resolveCallback(
        baseUrl,
        'http://localhost:5781/auth/twitch/callback',
        'http://localhost:5174',
      ).relay?.port,
    ).toBe(5781);
    expect(() =>
      resolveCallback(baseUrl, 'http://foreign.example:5199/auth/callback', dashboardUrl),
    ).toThrow();
    expect(() => resolveCallback(baseUrl, dashboardUrl + '/unsupported', dashboardUrl)).toThrow();
  });

  it.each([
    'https://foreign.example/auth/callback',
    'http://0.0.0.0:5781/auth/callback',
    'http://localhost:5781/auth/callback?code=private',
    'http://localhost:5781/auth/callback#private',
    'http://user:private@localhost:5781/auth/callback',
    'http://localhost:0/auth/callback',
    'https://localhost:5781/auth/callback',
    'http://localhost:3000/auth/host',
  ])('refuses an unsafe or conflicting callback without echoing its value', (callback) => {
    expect(() => resolveCallback(baseUrl, callback)).toThrow(
      'Invalid Twitch callback configuration',
    );
    try {
      resolveCallback(baseUrl, callback);
    } catch (error) {
      expect(String(error)).not.toContain('private');
    }
  });
});
