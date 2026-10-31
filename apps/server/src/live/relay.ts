import { createServer, type Server } from 'node:http';
import { resolveCallback, type CallbackConfig } from './config.js';
import { CallbackRedirect } from './redirect.js';

/** A single local redirect route; API routes and cookies stay on the main Fastify app. */
export class CallbackRelay {
  private readonly config: CallbackConfig;
  private server?: Server;
  private starting?: Promise<boolean>;

  constructor(
    baseUrl: string,
    redirectUri?: string,
    private readonly onError: () => void = () => undefined,
    dashboardUrl?: string,
  ) {
    this.config = resolveCallback(baseUrl, redirectUri, dashboardUrl);
  }

  get listening(): boolean {
    return this.server?.listening ?? false;
  }

  async start(): Promise<boolean> {
    const relay = this.config.relay;
    if (!relay) return false;
    if (this.starting) return this.starting;
    if (this.listening) return true;
    const redirect = new CallbackRedirect({
      paths: [this.config.path],
      authority: relay.authority,
      target: relay.target,
    });
    const server = createServer({ maxHeaderSize: 16384 }, (request, response) => {
      if (!redirect.handle(request, response)) {
        response.writeHead(404, { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        response.end();
      }
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.keepAliveTimeout = 1000;
    server.maxRequestsPerSocket = 1;
    server.on('error', () => {
      try {
        this.onError();
      } catch {
        /* Diagnostics cannot crash the API. */
      }
    });
    this.server = server;
    this.starting = new Promise<boolean>((resolve, reject) => {
      const failed = () => {
        this.server = undefined;
        reject(new Error('Twitch callback listener could not start'));
      };
      server.once('error', failed);
      server.listen({ host: relay.host, port: relay.port }, () => {
        server.off('error', failed);
        resolve(true);
      });
    });
    try {
      return await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  async stop(): Promise<void> {
    await this.starting?.catch(() => undefined);
    const server = this.server;
    this.server = undefined;
    if (!server?.listening) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}
