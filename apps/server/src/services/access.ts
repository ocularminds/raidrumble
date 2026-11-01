import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface AccessLimits {
  requestsPerIp: number;
  requestsGlobal: number;
  requestWindowMs: number;
  authPerIp: number;
  authGlobal: number;
  authWindowMs: number;
  maxClients: number;
  leaseMs: number;
  launchMs: number;
  resetMs: number;
  mutationMs: number;
}

const defaults: AccessLimits = {
  requestsPerIp: 600,
  requestsGlobal: 12_000,
  requestWindowMs: 60_000,
  authPerIp: 10,
  authGlobal: 60,
  authWindowMs: 60_000,
  maxClients: 2048,
  leaseMs: 240_000,
  launchMs: 5000,
  resetMs: 5000,
  mutationMs: 250,
};
const cookieName = '__Host-rrpreview';
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const logins = new Set(['/auth/host', '/auth/bot', '/auth/raider', '/auth/warlord']);
const controls = new Set([
  '/api/approve/demo',
  '/api/decline/demo',
  '/api/oil/demo',
  '/api/warlord/demo',
]);
const scenarios = new Set(['normal', 'stranger-raid', 'hate-raid', 'collab']);

interface Counter {
  used: number;
  expiresAt: number;
}
interface Client {
  lastSeen: number;
  requests?: Counter;
  auth?: Counter;
}
interface Lease {
  token: string;
  expiresAt: number;
  revision: number;
}
interface Reservation {
  revision: number;
  previous?: Lease;
}

/** HTTP admission only. Host identity and action authority remain in the existing routes/gate. */
export class ProductionAccess {
  private readonly origin: string;
  private readonly limits: AccessLimits;
  private readonly now: () => number;
  private readonly clients = new Map<string, Client>();
  private readonly reservations = new WeakMap<FastifyRequest, Reservation>();
  private requests?: Counter;
  private auth?: Counter;
  private lease?: Lease;
  private revision = 0;
  private lastLaunch = -Infinity;
  private lastReset = -Infinity;
  private lastMutation = -Infinity;

  constructor(options: { origin: string; now?: () => number; limits?: Partial<AccessLimits> }) {
    this.origin = productionOrigin(options.origin);
    this.now = options.now ?? Date.now;
    this.limits = { ...defaults, ...options.limits };
    if (Object.values(this.limits).some((value) => !Number.isSafeInteger(value) || value < 1))
      throw new Error('Production access limits must be positive integers.');
  }

  /** Install before routes. Do not install for local judge/development mode. */
  register(app: FastifyInstance): void {
    app.addHook('onRequest', async (request, reply) => this.request(request, reply));
    app.addHook('preHandler', async (request, reply) => this.demo(request, reply));
    app.addHook('onResponse', async (request, reply) => {
      const reservation = this.reservations.get(request);
      this.reservations.delete(request);
      if (reply.statusCode >= 400 && reservation?.revision === this.lease?.revision)
        this.lease = reservation?.previous;
    });
    app.addHook('onClose', async () => {
      this.clients.clear();
      this.lease = undefined;
    });
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private request(request: FastifyRequest, reply: FastifyReply): FastifyReply | undefined {
    const path = requestPath(request.url);
    if (!path) return this.reject(reply, 400, 'Invalid request path.');
    if (!['/api/', '/auth/', '/ws/'].some((prefix) => path.startsWith(prefix))) return;
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    const origin = request.headers.origin;
    if (!safeMethods.has(request.method) && origin !== this.origin)
      return this.reject(reply, 403, 'Use the RaidRumble site to submit this action.');
    if (path.startsWith('/ws/') && origin !== undefined && origin !== this.origin)
      return this.reject(reply, 403, 'Untrusted overlay origin.');
    return this.admit(request.ip, logins.has(path), reply);
  }

  private admit(ip: string, login: boolean, reply: FastifyReply): FastifyReply | undefined {
    const now = this.now();
    this.requests = counter(this.requests, now, this.limits.requestWindowMs);
    if (this.requests.used >= this.limits.requestsGlobal)
      return this.busy(reply, this.requests.expiresAt - now);
    const client = this.client(ip || 'unknown', now);
    client.requests = counter(client.requests, now, this.limits.requestWindowMs);
    if (client.requests.used >= this.limits.requestsPerIp)
      return this.busy(reply, client.requests.expiresAt - now);
    this.requests.used += 1;
    client.requests.used += 1;
    if (login) {
      this.auth = counter(this.auth, now, this.limits.authWindowMs);
      client.auth = counter(client.auth, now, this.limits.authWindowMs);
      if (this.auth.used >= this.limits.authGlobal || client.auth.used >= this.limits.authPerIp)
        return this.busy(reply, Math.max(this.auth.expiresAt, client.auth.expiresAt) - now);
      this.auth.used += 1;
      client.auth.used += 1;
    }
  }

  private client(ip: string, now: number): Client {
    const ttl = Math.max(this.limits.requestWindowMs, this.limits.authWindowMs);
    for (const [key, value] of this.clients)
      if (value.lastSeen + ttl <= now) this.clients.delete(key);
    const value = this.clients.get(ip) ?? { lastSeen: now };
    value.lastSeen = now;
    this.clients.delete(ip);
    this.clients.set(ip, value);
    while (this.clients.size > this.limits.maxClients) {
      const oldest = this.clients.keys().next().value;
      if (oldest === undefined) break;
      this.clients.delete(oldest);
    }
    return value;
  }

  private demo(request: FastifyRequest, reply: FastifyReply): FastifyReply | undefined {
    if (safeMethods.has(request.method)) return;
    const path = requestPath(request.url);
    if (!path?.startsWith('/api/') || !path.split('/').includes('demo')) return;
    if (path === '/api/settings/demo')
      return this.reject(
        reply,
        403,
        'The shared demo has fixed settings. Connect Twitch to configure your channel.',
      );
    if (path === '/api/approve/demo' && object(request.body)?.trustNextTime === true)
      return this.reject(
        reply,
        403,
        'The shared demo has fixed trust. Leave Trust next time unchecked.',
      );
    const launch = path === '/api/demo';
    const reset = path === '/api/demo/reset';
    if (!launch && !reset && !controls.has(path))
      return this.reject(reply, 403, 'Use Launch Test Raid for the shared demo.');
    if (launch && !validLaunch(request.body))
      return this.reject(reply, 400, 'Choose a shared demo preset at normal speed.');

    const now = this.now();
    if (this.lease && this.lease.expiresAt <= now) this.lease = undefined;
    const owner = this.owns(request);
    if ((this.lease && !owner) || (!launch && !owner))
      return this.reject(
        reply,
        409,
        this.lease
          ? 'The shared demo is in use. Watch it or try again in a few minutes.'
          : 'Launch a test raid to control the shared demo.',
      );
    const remaining = Math.max(
      this.lastMutation + this.limits.mutationMs - now,
      launch ? this.lastLaunch + this.limits.launchMs - now : 0,
      reset ? this.lastReset + this.limits.resetMs - now : 0,
    );
    if (remaining > 0) return this.busy(reply, remaining);
    this.lastMutation = now;
    if (reset) this.lastReset = now;
    if (launch) {
      this.lastLaunch = now;
      const previous = this.lease;
      this.lease = {
        token: previous?.token ?? randomBytes(32).toString('base64url'),
        expiresAt: now + this.limits.leaseMs,
        revision: ++this.revision,
      };
      this.reservations.set(request, { revision: this.lease.revision, previous });
      reply.header(
        'Set-Cookie',
        `${cookieName}=${this.lease.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.ceil(this.limits.leaseMs / 1000)}`,
      );
    }
  }

  private owns(request: FastifyRequest): boolean {
    if (!this.lease) return false;
    const cookies = request.headers.cookie?.split(';').map((part) => part.trim()) ?? [];
    const values = cookies.filter((part) => part.startsWith(`${cookieName}=`));
    if (values.length !== 1) return false;
    const token = values[0]!.slice(cookieName.length + 1);
    return (
      /^[A-Za-z0-9_-]{43}$/.test(token) &&
      timingSafeEqual(Buffer.from(token), Buffer.from(this.lease.token))
    );
  }

  private busy(reply: FastifyReply, milliseconds: number): FastifyReply {
    reply.header('Retry-After', Math.max(1, Math.ceil(milliseconds / 1000)));
    return this.reject(reply, 429, 'Please wait briefly before trying again.');
  }

  private reject(reply: FastifyReply, status: number, error: string): FastifyReply {
    return reply.code(status).send({ error });
  }
}

export function productionOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error('Production requires an HTTPS public origin without credentials or a path.');
  }
}

function requestPath(url: string): string | undefined {
  try {
    return decodeURIComponent(url.split('?')[0]!);
  } catch {
    return undefined;
  }
}

function counter(value: Counter | undefined, now: number, windowMs: number): Counter {
  return !value || value.expiresAt <= now ? { used: 0, expiresAt: now + windowMs } : value;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validLaunch(value: unknown): boolean {
  if (value === undefined) return true;
  const body = object(value);
  return Boolean(
    body &&
    Object.keys(body).every((key) => key === 'scenario' || key === 'speed') &&
    (body.scenario === undefined ||
      (typeof body.scenario === 'string' && scenarios.has(body.scenario))) &&
    (body.speed === undefined || body.speed === 1),
  );
}
