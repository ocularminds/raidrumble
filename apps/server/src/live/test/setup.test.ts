import { afterEach, describe, expect, it, vi } from 'vitest';
import { login } from './fixture.js';
import { failFirstWrite, setupFixture, settle, writes } from './setup.js';

const fixtures: ReturnType<typeof setupFixture>[] = [];
function setup() {
  const f = setupFixture();
  fixtures.push(f);
  return f;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    f.gate.release.resolve();
    await f.app.close();
  }
  vi.restoreAllMocks();
});

describe('per-channel EventSub setup', () => {
  it('queues host and bot before authorization and waits through receipt completion', async () => {
    const f = setup();
    const host = await login(f, 'host', '10');
    await login(f, 'bot', '10', host.cookie);
    const first = f.sockets[0]!.options.onSession('hostSession', { reconnected: false });
    const chat = f.sockets[1]!.options.onSession('botSession', { reconnected: false });
    await f.gate.entered.promise;
    const startedAt = f.clock.now;
    f.clock.now += 2_000;
    await settle();
    expect(f.gate.authorized).toHaveLength(1);
    expect(writes(f)).toHaveLength(1);
    f.gate.release.resolve();
    await Promise.all([first, chat]);
    expect(f.gate.authorized.map(({ atMs }) => atMs)).toEqual([
      startedAt,
      ...Array<number>(5).fill(startedAt + 2_000),
    ]);
    expect(f.gate.busy).toBe(0);
    expect(f.gate.outcomes).toEqual(Array<string>(6).fill('COMMITTED'));
    expect(f.service.status('10')).toMatchObject({
      hostEventsConnected: true,
      chatEventsConnected: true,
    });
  });

  it('allows another channel to finish while the first channel awaits its receipt', async () => {
    const f = setup();
    await login(f, 'host', '10');
    await login(f, 'host', '30');
    const first = f.sockets[0]!.options.onSession('one', { reconnected: false });
    await f.gate.entered.promise;
    await f.sockets[1]!.options.onSession('two', { reconnected: false });
    expect(f.service.status('30').hostEventsConnected).toBe(true);
    expect(f.service.status('10').hostEventsConnected).toBe(false);
    expect(f.gate.authorized.filter(({ request }) => request.channel.hostId === '10')).toHaveLength(
      1,
    );
    f.gate.release.resolve();
    await first;
    expect(f.gate.busy).toBe(0);
    expect(f.service.status('10').hostEventsConnected).toBe(true);
  });

  it.each(['session', 'account'] as const)(
    'drops queued work for a replaced host %s',
    async (kind) => {
      const f = setup();
      const host = await login(f, 'host', '10');
      const old = f.sockets[0]!.options.onSession('old', { reconnected: false });
      await f.gate.entered.promise;
      if (kind === 'account') await login(f, 'host', '10', host.cookie);
      const socket = f.sockets[kind === 'account' ? 1 : 0]!;
      const replacement = socket.options.onSession('replacement', { reconnected: false });
      f.gate.release.resolve();
      await Promise.all([old, replacement]);
      expect(writes(f).filter((write) => write.transport.session_id === 'old')).toHaveLength(1);
      expect(
        writes(f).filter((write) => write.transport.session_id === 'replacement'),
      ).toHaveLength(5);
      expect(f.gate.authorized).toHaveLength(6);
      expect(f.service.status('10').hostEventsConnected).toBe(true);
    },
  );

  it.each(['session', 'account'] as const)(
    'drops queued chat for a replaced bot %s',
    async (kind) => {
      const f = setup();
      const host = await login(f, 'host', '10');
      await login(f, 'bot', '10', host.cookie);
      const first = f.sockets[0]!.options.onSession('host', { reconnected: false });
      await f.gate.entered.promise;
      const old = f.sockets[1]!.options.onSession('oldBot', { reconnected: false });
      if (kind === 'account') await login(f, 'bot', '10', host.cookie);
      const socket = f.sockets[kind === 'account' ? 2 : 1]!;
      const replacement = socket.options.onSession('newBot', { reconnected: false });
      f.gate.release.resolve();
      await Promise.all([first, old, replacement]);
      const chat = writes(f).filter((write) => write.type === 'channel.chat.message');
      expect(chat).toHaveLength(1);
      expect(chat[0]?.transport.session_id).toBe('newBot');
      expect(f.service.status('10').chatEventsConnected).toBe(true);
    },
  );

  it.each(['reconnecting', 'stopped'] as const)(
    'skips queued work after the socket is %s',
    async (status) => {
      const f = setup();
      await login(f, 'host', '10');
      const first = f.sockets[0]!.options.onSession('old', { reconnected: false });
      await f.gate.entered.promise;
      f.sockets[0]!.status = status;
      f.gate.release.resolve();
      await first;
      expect(writes(f)).toHaveLength(1);
      expect(f.gate.authorized).toHaveLength(1);
      expect(f.service.status('10').hostEventsConnected).toBe(false);
    },
  );

  it('invalidates queued descriptors when a host session migrates', async () => {
    const f = setup();
    await login(f, 'host', '10');
    const first = f.sockets[0]!.options.onSession('old', { reconnected: false });
    await f.gate.entered.promise;
    await f.sockets[0]!.options.onSession('migrated', { reconnected: true });
    f.gate.release.resolve();
    await first;
    expect(f.gate.authorized).toHaveLength(1);
    expect(writes(f)).toHaveLength(1);
    expect(f.service.status('10').setupError).toMatch(/reconnect this channel/i);
  });

  it('invalidates a queued bot descriptor when its session migrates', async () => {
    const f = setup();
    const host = await login(f, 'host', '10');
    await login(f, 'bot', '10', host.cookie);
    const first = f.sockets[0]!.options.onSession('host', { reconnected: false });
    await f.gate.entered.promise;
    const queued = f.sockets[1]!.options.onSession('oldBot', { reconnected: false });
    await f.sockets[1]!.options.onSession('migratedBot', { reconnected: true });
    f.gate.release.resolve();
    await Promise.all([first, queued]);
    expect(writes(f).filter((write) => write.type === 'channel.chat.message')).toHaveLength(0);
    expect(f.service.status('10').chatEventsConnected).toBe(false);
    expect(f.service.status('10').setupError).toMatch(/reconnect the bot/i);
  });

  it('rechecks duplicate chat setup after acquiring the channel queue', async () => {
    const f = setup();
    const host = await login(f, 'host', '10');
    await login(f, 'bot', '10', host.cookie);
    const first = f.sockets[0]!.options.onSession('host', { reconnected: false });
    await f.gate.entered.promise;
    const bot = f.sockets[1]!.options.onSession('bot', { reconnected: false });
    const duplicate = login(f, 'raider', '10');
    await vi.waitFor(() =>
      expect(
        f.fetcher.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/oauth2/validate') &&
            new Headers(init?.headers).get('Authorization') === 'OAuth 10:raider',
        ),
      ).toBe(true),
    );
    await settle();
    f.gate.release.resolve();
    await Promise.all([first, bot, duplicate]);
    expect(writes(f).filter((write) => write.type === 'channel.chat.message')).toHaveLength(1);
    expect(f.gate.authorized).toHaveLength(6);
  });

  it('releases the queue after a failed effect without retrying that subscription', async () => {
    const f = setup();
    await login(f, 'host', '10');
    const authorize = failFirstWrite(f);
    const first = f.sockets[0]!.options.onSession('host', { reconnected: false });
    await f.gate.entered.promise;
    f.gate.release.resolve();
    await first;
    expect(authorize).toHaveBeenCalledTimes(5);
    expect(writes(f).filter((write) => write.type === 'channel.raid')).toHaveLength(1);
    expect(f.gate.outcomes).toEqual(['INDETERMINATE', ...Array<string>(4).fill('COMMITTED')]);
    expect(f.service.status('10').subscriptions).toHaveLength(4);
    expect(JSON.stringify(f.service.status('10'))).not.toContain('private downstream error');
  });

  it.each(['network', 'unconfirmed'] as const)(
    'does not replay a duplicate queued subscription after an ambiguous %s outcome',
    async (outcome) => {
      const f = setup();
      const host = await login(f, 'host', '10');
      await login(f, 'bot', '10', host.cookie);
      const original = f.fetcher.getMockImplementation()!;
      let attempts = 0;
      f.fetcher.mockImplementation(async (input, init) => {
        if (
          String(input).includes('/helix/eventsub') &&
          (JSON.parse(String(init?.body)) as { type: string }).type === 'channel.chat.message' &&
          ++attempts === 1
        ) {
          if (outcome === 'network') throw new Error('response lost after dispatch');
          return Response.json({ data: [] }, { status: 202 });
        }
        return original(input, init);
      });
      const first = f.sockets[0]!.options.onSession('host', { reconnected: false });
      await f.gate.entered.promise;
      const bot = f.sockets[1]!.options.onSession('bot', { reconnected: false });
      const duplicate = login(f, 'raider', '10');
      await vi.waitFor(() =>
        expect(
          f.fetcher.mock.calls.some(
            ([url, init]) =>
              String(url).includes('/oauth2/validate') &&
              new Headers(init?.headers).get('Authorization') === 'OAuth 10:raider',
          ),
        ).toBe(true),
      );
      await settle();
      f.gate.release.resolve();
      await Promise.all([first, bot, duplicate]);
      expect(attempts).toBe(1);
      expect(f.gate.authorized).toHaveLength(6);
      expect(f.service.status('10').chatEventsConnected).toBe(false);
    },
  );

  it('releases the queue when authorization throws, without retrying the held request', async () => {
    const f = setup();
    await login(f, 'host', '10');
    vi.spyOn(f.gate, 'authorize').mockRejectedValueOnce(new Error('private authority error'));
    const first = f.sockets[0]!.options.onSession('host', { reconnected: false });
    await f.gate.entered.promise;
    f.gate.release.resolve();
    await first;
    expect(writes(f)).toHaveLength(4);
    expect(writes(f).some((write) => write.type === 'channel.raid')).toBe(false);
    expect(f.gate.busy).toBe(0);
  });

  it('releases the queue after receipt failure and keeps the completed effect enabled', async () => {
    const f = setup();
    await login(f, 'host', '10');
    const first = f.sockets[0]!.options.onSession('host', { reconnected: false });
    await f.gate.entered.promise;
    f.gate.release.reject(new Error('private receipt error'));
    await first;
    expect(writes(f)).toHaveLength(5);
    expect(f.gate.busy).toBe(0);
    expect(f.service.status('10').hostEventsConnected).toBe(true);
  });
});
