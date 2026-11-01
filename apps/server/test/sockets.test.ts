import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { SocketPool } from '../src/services/socket.js';

const origin = 'https://raids.example';
const request = (ip = '192.0.2.1', source?: string) => ({
  ip,
  headers: source ? { origin: source } : {},
});

class TestSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  readonly close = vi.fn((_code?: number, _reason?: string) => undefined);
  readonly terminate = vi.fn(() => {
    this.readyState = 3;
    this.emit('close');
  });
}

describe('bounded public overlay sockets', () => {
  it('accepts no-Origin OBS and the configured origin, rejecting every foreign present origin', () => {
    const pool = new SocketPool({ origin });
    expect(pool.attach(new TestSocket(), request())).toBe(true);
    expect(pool.attach(new TestSocket(), request('192.0.2.1', origin))).toBe(true);
    for (const source of ['null', 'https://foreign.example']) {
      const socket = new TestSocket();
      expect(pool.attach(socket, request('192.0.2.2', source))).toBe(false);
      expect(socket.terminate).toHaveBeenCalledOnce();
      expect(() => socket.emit('error', new Error('Rejected socket closed'))).not.toThrow();
    }
    expect(pool.size).toBe(2);
    pool.close();
  });

  it('caps connections per IP and globally, then reclaims a disconnected slot', () => {
    const pool = new SocketPool({ origin, limits: { perIp: 1, total: 2 } });
    const first = new TestSocket();
    expect(pool.attach(first, request())).toBe(true);
    expect(pool.attach(new TestSocket(), request())).toBe(false);
    expect(pool.attach(new TestSocket(), request('192.0.2.2'))).toBe(true);
    expect(pool.attach(new TestSocket(), request('192.0.2.3'))).toBe(false);
    first.emit('close');
    first.emit('error', new Error('Already closed'));
    expect(pool.size).toBe(1);
    expect(pool.attach(new TestSocket(), request())).toBe(true);
    expect(pool.size).toBe(2);
    pool.close();
  });

  it('evicts backed-up clients instead of retaining their buffers indefinitely', () => {
    const pool = new SocketPool({ origin, limits: { maxBufferedBytes: 64 } });
    const socket = new TestSocket();
    pool.attach(socket, request());
    socket.bufferedAmount = 63;
    expect(pool.canSend(socket)).toBe(true);
    socket.bufferedAmount = 64;
    expect(pool.canSend(socket)).toBe(false);
    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(pool.size).toBe(0);
    expect(pool.canSend(socket)).toBe(false);
  });

  it('treats all client data as a read-only protocol violation', () => {
    const pool = new SocketPool({ origin });
    const socket = new TestSocket();
    pool.attach(socket, request());
    socket.emit('message', Buffer.from('{"action":"approve"}'));
    expect(socket.close).toHaveBeenCalledWith(1008, 'Overlay connections are read-only.');
    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(pool.size).toBe(0);
  });

  it('reclaims error/closing sockets and closes the pool idempotently', () => {
    const pool = new SocketPool({ origin });
    const errored = new TestSocket();
    const closing = new TestSocket();
    pool.attach(errored, request());
    pool.attach(closing, request());
    errored.emit('error', new Error('Disconnected'));
    closing.readyState = 2;
    expect(pool.canSend(closing)).toBe(false);
    expect(pool.size).toBe(0);
    const last = new TestSocket();
    pool.attach(last, request());
    pool.close();
    pool.close();
    expect(last.terminate).toHaveBeenCalledOnce();
    expect(pool.size).toBe(0);
  });

  it('enforces the configured message-size limit in the actual Fastify WebSocket adapter', async () => {
    const pool = new SocketPool({ origin, limits: { maxPayload: 64 } });
    const app = Fastify();
    await app.register(websocket, pool.websocketOptions);
    app.get('/ws/demo', { websocket: true }, (socket, req) => {
      pool.attach(socket, req);
    });
    await app.ready();
    try {
      const client = await app.injectWS('/ws/demo', { headers: { origin } });
      expect(pool.size).toBe(1);
      const ended = new Promise<void>((resolve) => {
        client.once('close', () => resolve());
      });
      client.send('x'.repeat(65));
      await ended;
      expect(pool.size).toBe(0);
    } finally {
      pool.close();
      await app.close();
    }
  });
});
