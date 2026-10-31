export interface TwitchConfig {
  clientId: string;
  clientSecret: string;
  botUserId: string;
  redirectUri: string;
}

export interface CallbackConfig {
  redirectUri: string;
  path: string;
  dashboard?: boolean;
  relay?: { host: string; port: number; authority: string; target: string };
}

const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const loginPaths = new Set(['/auth/host', '/auth/bot', '/auth/raider', '/auth/warlord']);

/** AUTH_URL names a registered callback; it never changes Twitch's identity endpoints. */
export function resolveTwitchConfig(
  env: Record<string, string | undefined>,
  baseUrl: string,
  dashboardUrl = env.DASHBOARD_URL?.trim() || 'http://localhost:5174',
): TwitchConfig {
  return {
    clientId: env.TWITCH_CLIENT_ID?.trim() || env.TWITCH_AUTH_CLIENT?.trim() || '',
    clientSecret: env.TWITCH_CLIENT_SECRET?.trim() || env.TWITCH_AUTH_SECRET?.trim() || '',
    botUserId: env.TWITCH_BOT_USER_ID?.trim() || '',
    redirectUri: resolveCallback(baseUrl, env.TWITCH_AUTH_URL?.trim() || undefined, dashboardUrl)
      .redirectUri,
  };
}

/** Different origins are permitted only for an explicit local callback listener. */
export function resolveCallback(
  baseUrl: string,
  redirectUri?: string,
  dashboardUrl?: string,
): CallbackConfig {
  try {
    const base = new URL(baseUrl);
    const callback = new URL(redirectUri ?? new URL('/auth/callback', base).toString());
    const dashboard = dashboardUrl ? new URL(dashboardUrl) : undefined;
    for (const url of [base, callback, ...(dashboard ? [dashboard] : [])])
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error();
    if (
      !/^\/[A-Za-z0-9_/.-]*$/.test(callback.pathname) ||
      loginPaths.has(callback.pathname) ||
      callback.port === '0'
    )
      throw new Error();
    const config: CallbackConfig = { redirectUri: callback.toString(), path: callback.pathname };
    if (callback.origin === base.origin) return config;
    if (
      !loopback.has(base.hostname) ||
      !loopback.has(callback.hostname) ||
      base.protocol !== 'http:' ||
      callback.protocol !== 'http:' ||
      !callback.port ||
      Number(callback.port) === Number(base.port || 80)
    )
      throw new Error();
    if (callback.origin === dashboard?.origin) {
      if (!['/auth/callback', '/auth/twitch/callback'].includes(callback.pathname))
        throw new Error();
      return { ...config, dashboard: true };
    }
    return {
      ...config,
      relay: {
        host: callback.hostname === '[::1]' ? '::1' : '127.0.0.1',
        port: Number(callback.port),
        authority: callback.host,
        target: new URL('/auth/callback', base).toString(),
      },
    };
  } catch {
    // Configuration can contain credentials. Never include the supplied URL in an error.
    throw new Error('Invalid Twitch callback configuration');
  }
}
