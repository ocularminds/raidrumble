import type { FastifyRequest } from 'fastify';
import { productionOrigin } from './access.js';

export interface SocketLimits {
  total: number;
  perIp: number;
  maxPayload: number;
  maxBufferedBytes: number;
}

export interface PoolSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  on(event: string, listener: () => void): unknown;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

/** Bounds public, read-only OBS streams independently of host authentication. */
export class SocketPool {
  readonly websocketOptions: { options: { maxPayload: number; perMessageDeflate: false } };
  private readonly clients = new Map<PoolSocket, string>();
  private readonly addresses = new Map<string, number>();
  private readonly limits: SocketLimits;
  private readonly origin: string;

  constructor(options: { origin: string; limits?: Partial<SocketLimits> }) {
    this.origin = productionOrigin(options.origin);
    this.limits = {
      total: 128,
      perIp: 8,
      maxPayload: 1024,
      maxBufferedBytes: 131072,
      ...options.limits,
    };
    if (Object.values(this.limits).some((value) => !Number.isSafeInteger(value) || value < 1))
      throw new Error('Overlay limits must be positive integers.');
    this.websocketOptions = {
      options: { maxPayload: this.limits.maxPayload, perMessageDeflate: false },
    };
  }

  get size(): number {
    return this.clients.size;
  }

  /** Call once before registering a socket in the application's fan-out map. */
  attach(socket: PoolSocket, request: Pick<FastifyRequest, 'ip' | 'headers'>): boolean {
    if (this.clients.has(socket)) return true;
    socket.on('error', () => this.drop(socket));
    const origin = request.headers.origin;
    const ip = request.ip || 'unknown';
    const count = this.addresses.get(ip) ?? 0;
    if (
      socket.readyState !== 1 ||
      (origin !== undefined && origin !== this.origin) ||
      this.clients.size >= this.limits.total ||
      count >= this.limits.perIp
    ) {
      socket.close(1008, 'Overlay connection unavailable.');
      socket.terminate();
      return false;
    }
    this.clients.set(socket, ip);
    this.addresses.set(ip, count + 1);
    socket.on('close', () => this.remove(socket));
    socket.on('message', () => {
      socket.close(1008, 'Overlay connections are read-only.');
      this.drop(socket);
    });
    return true;
  }

  /** Call at every send; slow, errored, or closing clients are immediately removed. */
  canSend(socket: PoolSocket): boolean {
    if (!this.clients.has(socket)) return false;
    if (socket.readyState !== 1 || socket.bufferedAmount >= this.limits.maxBufferedBytes) {
      this.drop(socket);
      return false;
    }
    return true;
  }

  close(): void {
    for (const socket of [...this.clients.keys()]) this.drop(socket);
  }

  private drop(socket: PoolSocket): void {
    if (!this.clients.has(socket)) return;
    this.remove(socket);
    socket.terminate();
  }

  private remove(socket: PoolSocket): void {
    const ip = this.clients.get(socket);
    if (ip === undefined) return;
    this.clients.delete(socket);
    const count = (this.addresses.get(ip) ?? 1) - 1;
    if (count > 0) this.addresses.set(ip, count);
    else this.addresses.delete(ip);
  }
}
