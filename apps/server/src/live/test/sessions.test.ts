import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TwitchIdentity } from '@raidrumble/twitch';
import { describe, expect, it, vi } from 'vitest';
import { BrowserSessions } from '../sessions.js';

const pendingMs = 10 * 60_000;
const authenticatedMs = 12 * 3_600_000;
const identity: TwitchIdentity = {
  userId: '10',
  login: 'host',
  scopes: [],
  expiresIn: 3600,
};

function request(id?: string): FastifyRequest {
  return { headers: id ? { cookie: `rrsession=${id}` } : {} } as FastifyRequest;
}

function response() {
  const header = vi.fn();
  return { reply: { header } as unknown as FastifyReply, header };
}

function fixture() {
  let now = 1000;
  const sessions = new BrowserSessions('https://arena.example', 'https://arena.example', () => now);
  return { sessions, now: () => now, setNow: (value: number) => (now = value) };
}

describe('Browser session lifetimes', () => {
  it('limits unfinished authentication to ten minutes without renewing it on reuse', () => {
    const f = fixture();
    const first = response();
    const session = f.sessions.ensure(request(), first.reply);
    const deadline = f.now() + pendingMs;
    expect(session.expiresAt).toBe(deadline);
    expect(first.header).toHaveBeenCalledWith(
      'Set-Cookie',
      `rrsession=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`,
    );
    f.setNow(deadline - 1);
    const retry = response();
    expect(f.sessions.ensure(request(session.id), retry.reply).id).toBe(session.id);
    expect(retry.header).not.toHaveBeenCalled();
    expect(f.sessions.get(request(session.id))?.expiresAt).toBe(deadline);

    f.setNow(deadline);
    expect(f.sessions.get(request(session.id))).toBeUndefined();
    const replacement = f.sessions.ensure(request(session.id), response().reply);
    expect(replacement.id).not.toBe(session.id);
    expect(replacement.expiresAt).toBe(deadline + pendingMs);
  });

  it('recovers saturated pending capacity after ten minutes while retaining authenticated users', () => {
    const f = fixture();
    const sink = response().reply;
    const retained = f.sessions.ensure(request(), sink);
    f.sessions.setIdentity(retained.id, 'host', identity);
    for (let index = 1; index < 10_000; index++) f.sessions.ensure(request(), sink);
    expect(() => f.sessions.ensure(request(), sink)).toThrow('Too many active login sessions');

    f.setNow(f.now() + pendingMs);
    expect(() => f.sessions.ensure(request(), sink)).not.toThrow();
    expect(f.sessions.identity(request(retained.id), 'host')).toEqual(identity);
  });

  it('upgrades a verified identity to a new absolute twelve-hour lifetime and cookie', () => {
    const f = fixture();
    const session = f.sessions.ensure(request(), response().reply);
    f.setNow(f.now() + pendingMs - 1000);
    const promotedAt = f.now();
    const promoted = response();
    f.sessions.setIdentity(session.id, 'host', identity, promoted.reply);
    const deadline = promotedAt + authenticatedMs;
    expect(f.sessions.get(request(session.id))?.expiresAt).toBe(deadline);
    expect(promoted.header).toHaveBeenCalledWith(
      'Set-Cookie',
      `rrsession=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure`,
    );

    f.setNow(deadline - 1);
    const access = response();
    expect(f.sessions.ensure(request(session.id), access.reply).id).toBe(session.id);
    expect(f.sessions.identity(request(session.id), 'host')).toEqual(identity);
    expect(access.header).not.toHaveBeenCalled();
    expect(f.sessions.get(request(session.id))?.expiresAt).toBe(deadline);
    f.setNow(deadline);
    expect(f.sessions.identity(request(session.id), 'host')).toBeUndefined();
  });

  it('does not resurrect an expired or missing browser during identity promotion', () => {
    const f = fixture();
    const session = f.sessions.ensure(request(), response().reply);
    f.setNow(f.now() + pendingMs);
    const promoted = response();
    expect(() => f.sessions.setIdentity(session.id, 'host', identity, promoted.reply)).toThrow(
      'Browser session expired',
    );
    expect(() => f.sessions.setIdentity('missing', 'host', identity, promoted.reply)).toThrow(
      'Browser session expired',
    );
    expect(promoted.header).not.toHaveBeenCalled();
  });

  it('renews only after another successful login while keeping existing role identities', () => {
    const f = fixture();
    const session = f.sessions.ensure(request(), response().reply);
    f.sessions.setIdentity(session.id, 'host', identity);
    f.setNow(f.now() + 3_600_000);
    const bot = { ...identity, userId: '20', login: 'bot' };
    const promoted = response();
    f.sessions.setIdentity(session.id, 'bot', bot, promoted.reply);
    expect(f.sessions.get(request(session.id))?.expiresAt).toBe(f.now() + authenticatedMs);
    expect(f.sessions.identity(request(session.id), 'host')).toEqual(identity);
    expect(f.sessions.identity(request(session.id), 'bot')).toEqual(bot);
    expect(promoted.header).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('Max-Age=43200'),
    );
  });
});
