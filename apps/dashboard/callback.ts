import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { resolveCallback } from '../server/src/live/config.js';
import { CallbackRedirect } from '../server/src/live/redirect.js';

export function callbackMiddleware(baseUrl: string, dashboardUrl: string) {
  try {
    const dashboard = new URL(dashboardUrl);
    const callback = new URL('/auth/twitch/callback', dashboard).toString();
    if (!resolveCallback(baseUrl, callback, dashboardUrl).dashboard) throw new Error();
    const redirect = new CallbackRedirect({
      paths: ['/auth/callback', '/auth/twitch/callback'],
      authority: dashboard.host,
      target: new URL('/auth/callback', baseUrl).toString(),
    });
    return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
      if (!redirect.handle(request, response)) next();
    };
  } catch {
    throw new Error('Dashboard callback forwarding requires distinct HTTP loopback origins');
  }
}

export function callbackPlugin(baseUrl: string, dashboardUrl: string): Plugin {
  const middleware = callbackMiddleware(baseUrl, dashboardUrl);
  return {
    name: 'twitchcallback',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
