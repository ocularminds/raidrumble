import { afterEach, describe, expect, it, vi } from 'vitest';
import { login } from './fixture.js';
import { deferred, setupFixture, settle, writes } from './setup.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks();
});

async function claiming(role: 'host' | 'bot', phase: 'authorize' | 'claim' = 'claim') {
  const f = setupFixture();
  const entered = deferred();
  const release = deferred();
  cleanup.push(async () => {
    release.resolve();
    f.gate.release.resolve();
    await f.app.close();
  });
  f.gate.release.resolve();
  const host = await login(f, 'host', '10');
  if (role === 'bot') {
    await login(f, 'bot', '10', host.cookie);
    await f.sockets[0]!.options.onSession('readyHost', { reconnected: false });
  }
  if (phase === 'authorize') {
    const authorize = f.gate.authorize.bind(f.gate);
    vi.spyOn(f.gate, 'authorize').mockImplementationOnce(async (request) => {
      const decision = await authorize(request);
      entered.resolve();
      await release.promise;
      return decision;
    });
  } else {
    const claim = f.gate.claimGrant.bind(f.gate);
    vi.spyOn(f.gate, 'claimGrant').mockImplementationOnce(async (id) => {
      const claimed = await claim(id);
      entered.resolve();
      await release.promise;
      return claimed;
    });
  }
  const socket = f.sockets.at(-1)!;
  const pending = socket.options.onSession('oldSession', { reconnected: false });
  await entered.promise;
  return { f, host, socket, release, pending };
}

describe('EventSub sessions invalidated while claiming authority', () => {
  it.each(['authorize', 'claim'] as const)(
    'allows fresh chat setup when host reauthorization cancels pending chat during %s',
    async (phase) => {
      const { f, host, release, pending } = await claiming('bot', phase);
      const reauthorize = login(f, 'host', '10', host.cookie);
      await vi.waitFor(() => expect(f.onHost).toHaveBeenCalledTimes(2));
      await settle();
      release.resolve();
      await Promise.all([pending, reauthorize]);
      expect(writes(f).filter((write) => write.type === 'channel.chat.message')).toHaveLength(1);
      expect(f.service.status('10').chatEventsConnected).toBe(true);
      expect(f.gate.busy).toBe(0);
    },
  );

  it.each(['host', 'bot'] as const)(
    'does not dispatch to an old %s session after a cold reconnect during claim',
    async (role) => {
      const { f, socket, release, pending } = await claiming(role);
      const replacement = socket.options.onSession('replacement', { reconnected: false });
      release.resolve();
      await Promise.all([pending, replacement]);
      expect(writes(f).some((write) => write.transport.session_id === 'oldSession')).toBe(false);
      expect(
        writes(f).filter((write) => write.transport.session_id === 'replacement'),
      ).toHaveLength(role === 'host' ? 5 : 1);
      expect(f.gate.outcomes.filter((outcome) => outcome === 'FAILED')).toHaveLength(1);
      expect(f.gate.busy).toBe(0);
    },
  );

  it.each(['host', 'bot'] as const)(
    'does not dispatch for an old %s account after reauthorization during claim',
    async (role) => {
      const { f, host, release, pending } = await claiming(role);
      await login(f, role, '10', host.cookie);
      const replacement = f.sockets
        .at(-1)!
        .options.onSession('replacement', { reconnected: false });
      release.resolve();
      await Promise.all([pending, replacement]);
      expect(writes(f).some((write) => write.transport.session_id === 'oldSession')).toBe(false);
      expect(f.gate.outcomes.filter((outcome) => outcome === 'FAILED')).toHaveLength(1);
    },
  );

  it.each(['host', 'bot'] as const)(
    'does not dispatch after the %s authorization is revoked during claim',
    async (role) => {
      const { f, socket, release, pending } = await claiming(role);
      await socket.options.onRevocation?.({
        id: 'revoked',
        type: 'channel.raid',
        status: 'authorization_revoked',
      });
      release.resolve();
      await pending;
      expect(writes(f).some((write) => write.transport.session_id === 'oldSession')).toBe(false);
      expect(f.gate.outcomes.at(-1)).toBe('FAILED');
    },
  );

  it.each(['host', 'bot'] as const)(
    'does not dispatch when the %s socket stops during claim',
    async (role) => {
      const { f, socket, release, pending } = await claiming(role);
      socket.stop();
      release.resolve();
      await pending;
      expect(writes(f).some((write) => write.transport.session_id === 'oldSession')).toBe(false);
      expect(f.gate.outcomes.at(-1)).toBe('FAILED');
    },
  );
});
