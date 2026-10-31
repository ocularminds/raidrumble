import { describe, expect, it } from 'vitest';
import { LocalPolicyGate } from '@raidrumble/policy';
import type { RaidNotification } from '@raidrumble/twitch';
import { fixture, login } from './fixture.js';

const raid: RaidNotification = {
  type: 'raid',
  id: 'raid1',
  occurredAt: 1_798_000_000_000,
  hostId: '10',
  hostLogin: 'stream10',
  hostName: 'Stream 10',
  raiderId: '30',
  raiderLogin: 'stream30',
  raiderName: 'Stream 30',
  viewers: 300,
};

describe('Live EventSub integration', () => {
  it('does not register subscriptions when the gate blocks them in enforce mode', async () => {
    const f = fixture();
    await login(f, 'host', '10');
    const gate = new LocalPolicyGate(undefined, {
      logger: () => undefined,
      evaluate: () => ({ verdict: 'BLOCK', reasonCodes: ['SETUP_BLOCKED'] }),
    });
    gate.setMode('events.subscribe', 'enforce');
    f.gates.set('10', gate);
    await f.sockets[0]!.options.onSession('blocked', { reconnected: false });
    expect(
      f.fetcher.mock.calls.filter(([url]) => String(url).includes('/helix/eventsub')),
    ).toHaveLength(0);
    expect(f.onError).toHaveBeenCalled();
    await f.app.close();
  });

  it('gates every host subscription and uses a separate bot connection for chat', async () => {
    const f = fixture();
    const host = await login(f, 'host', '10');
    await f.sockets[0]!.options.onSession('hostsession', { reconnected: false });
    const hostWrites = f.fetcher.mock.calls.filter(
      ([url, init]) => String(url).includes('/helix/eventsub') && init?.method === 'POST',
    );
    expect(hostWrites).toHaveLength(5);
    expect(
      f.gates
        .get('10')!
        .listRecords()
        .filter((record) => record.action === 'events.subscribe'),
    ).toHaveLength(5);
    expect(
      hostWrites.every(
        ([, init]) => new Headers(init?.headers).get('Authorization') === 'Bearer 10:host',
      ),
    ).toBe(true);
    await login(f, 'bot', '20', host.cookie);
    await f.sockets[1]!.options.onSession('botsession', { reconnected: false });
    const lastWrite = f.fetcher.mock.calls
      .filter(([url]) => String(url).includes('/helix/eventsub'))
      .at(-1)!;
    expect(JSON.parse(String(lastWrite[1]?.body))).toMatchObject({
      type: 'channel.chat.message',
      condition: { broadcaster_user_id: '10', user_id: '20' },
      transport: { session_id: 'botsession' },
    });
    expect(new Headers(lastWrite[1]?.headers).get('Authorization')).toBe('Bearer 20:bot');
    await f.app.close();
  });

  it('does not recreate subscriptions during a server-directed migration', async () => {
    const f = fixture();
    await login(f, 'host', '10');
    await f.sockets[0]!.options.onSession('hostsession', { reconnected: false });
    const count = f.fetcher.mock.calls.length;
    await f.sockets[0]!.options.onSession('migrated', { reconnected: true });
    expect(f.fetcher.mock.calls).toHaveLength(count);
    await f.sockets[0]!.options.onSession('replacement', { reconnected: false });
    expect(f.fetcher.mock.calls.length).toBe(count + 5);
    await f.app.close();
  });

  it('enriches only raids for the bound host with account age and both profiles', async () => {
    const f = fixture();
    await login(f, 'host', '10');
    await f.sockets[0]!.options.onNotification(raid);
    expect(f.onRaid).toHaveBeenCalledWith(
      '10',
      expect.objectContaining({
        eventId: 'raid1',
        viewers: 300,
        raiderLogin: 'stream30',
        hostFollowsRaider: false,
        accountAgeDays: expect.any(Number),
        channels: {
          host: expect.objectContaining({ id: '10', category: 'Gardening' }),
          raider: expect.objectContaining({ id: '30', category: 'Speedrunning' }),
        },
      }),
    );
    await f.sockets[0]!.options.onNotification({ ...raid, hostId: 'evil' });
    expect(f.onRaid).toHaveBeenCalledOnce();
    await f.app.close();
  });

  it('keeps failed policy facts unknown and continues handling the raid', async () => {
    const f = fixture();
    await login(f, 'host', '10');
    f.fetcher.mockRejectedValue(new Error('read unavailable'));
    await f.sockets[0]!.options.onNotification(raid);
    expect(f.onRaid).toHaveBeenCalledWith(
      '10',
      expect.objectContaining({ accountAgeDays: null, hostFollowsRaider: null }),
    );
    await f.app.close();
  });

  it('routes Shared Chat and redemption events without leaking to other hosts', async () => {
    const f = fixture();
    await login(f, 'host', '10');
    await f.sockets[0]!.options.onNotification({
      type: 'shared',
      id: 'share',
      occurredAt: raid.occurredAt,
      phase: 'begin',
      sessionId: 'shared',
      channelId: '10',
      hostBroadcasterId: '10',
      participants: ['10', '30'],
    });
    expect(f.onShared).toHaveBeenCalledWith('10', ['10', '30']);
    await f.sockets[0]!.options.onNotification({
      type: 'redemption',
      id: 'redeem',
      occurredAt: raid.occurredAt,
      channelId: '10',
      userId: 'viewer',
      redemptionId: 'one',
      rewardId: 'reward',
      status: 'unfulfilled',
    });
    expect(f.onRedemption).toHaveBeenCalledWith(
      '10',
      expect.objectContaining({ rewardId: 'reward' }),
    );
    await f.app.close();
  });

  it('captures authorized raider rosters in memory and clears them after a match', async () => {
    const f = fixture();
    const host = await login(f, 'host', '10');
    await login(f, 'bot', '20', host.cookie);
    await f.sockets[1]!.options.onSession('botsession', { reconnected: false });
    await login(f, 'raider', '30');
    await f.sockets[1]!.options.onNotification({
      type: 'chat',
      id: 'chat',
      occurredAt: raid.occurredAt,
      channelId: '30',
      userId: 'viewer',
      login: 'viewer',
      displayName: 'Viewer',
      messageId: 'chat1',
      text: 'Hello',
    });
    expect(f.onRoster).toHaveBeenCalledWith('30', expect.objectContaining({ userId: 'viewer' }));
    expect(f.service.roster('30')).toEqual(['viewer']);
    expect(f.onChat).not.toHaveBeenCalled();
    f.service.clearRoster('30');
    expect(f.service.roster('30')).toEqual([]);
    await f.app.close();
    expect(f.sockets.every((socket) => socket.stopped)).toBe(true);
  });

  it('excludes Shared Chat visitors from rosters and expires old native chatters', async () => {
    const f = fixture();
    const host = await login(f, 'host', '10');
    await login(f, 'bot', '20', host.cookie);
    await login(f, 'raider', '30');
    const event = {
      type: 'chat' as const,
      id: 'chat',
      occurredAt: raid.occurredAt,
      channelId: '30',
      userId: 'viewer',
      login: 'viewer',
      displayName: 'Viewer',
      messageId: 'chat1',
      text: 'Hello',
    };
    await f.sockets[1]!.options.onNotification({ ...event, sourceBroadcasterId: 'otherChannel' });
    expect(f.service.roster('30')).toEqual([]);
    await f.sockets[1]!.options.onNotification(event);
    f.setNow(raid.occurredAt + 30 * 60_000 + 1);
    expect(f.service.roster('30')).toEqual([]);
    await f.app.close();
  });
});
