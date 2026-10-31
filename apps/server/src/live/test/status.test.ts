import { describe, expect, it } from 'vitest';
import type { SubscriptionRevocation } from '@raidrumble/twitch';
import { fixture, login } from './fixture.js';

const hostTypes = [
  'channel.channel_points_custom_reward_redemption.add',
  'channel.raid',
  'channel.shared_chat.begin',
  'channel.shared_chat.end',
  'channel.shared_chat.update',
];
const revocation: SubscriptionRevocation = {
  id: 'privateSubscription',
  type: 'channel.raid',
  status: 'authorization_revoked',
};

async function connected() {
  const f = fixture();
  const host = await login(f, 'host', '10');
  await login(f, 'bot', '20', host.cookie);
  await f.sockets[0]!.options.onSession('privateHostSession', { reconnected: false });
  await f.sockets[1]!.options.onSession('privateBotSession', { reconnected: false });
  return f;
}

describe('Twitch readiness diagnostics', () => {
  it('distinguishes OAuth identity from an enabled event subscription', async () => {
    const f = fixture();
    await login(f, 'host', '10');
    expect(f.service.status('10')).toEqual({
      configured: true,
      hostConnected: true,
      botConnected: false,
      hostEventsConnected: false,
      chatEventsConnected: false,
      subscriptions: [],
      eventCount: 0,
    });
    await f.sockets[0]!.options.onSession('privateHostSession', { reconnected: false });
    expect(f.service.status('10')).toMatchObject({
      hostEventsConnected: true,
      chatEventsConnected: false,
      subscriptions: hostTypes,
    });
    await f.app.close();
  });

  it.each(['missing', 'pending', 'wrongCondition', 'wrongSession', 'failed'])(
    'does not report readiness for a %s subscription response even after policy ALLOW',
    async (kind) => {
      const f = fixture();
      await login(f, 'host', '10');
      const fetcher = f.fetcher.getMockImplementation()!;
      f.fetcher.mockImplementation(async (input, init) => {
        if (!String(input).includes('/helix/eventsub')) return fetcher(input, init);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const entry: Record<string, unknown> = {
          id: 'privateSubscription',
          status: 'enabled',
          ...body,
        };
        if (kind === 'pending') entry.status = 'webhook_callback_verification_pending';
        if (kind === 'wrongCondition') entry.condition = { broadcaster_user_id: 'otherHost' };
        if (kind === 'wrongSession')
          entry.transport = { method: 'websocket', session_id: 'wrongSession' };
        return Response.json(
          kind === 'missing'
            ? { data: [], privateToken: 'providerSecret' }
            : { data: [entry], message: 'providerSecret' },
          { status: kind === 'failed' ? 500 : 202 },
        );
      });
      await f.sockets[0]!.options.onSession('privateHostSession', { reconnected: false });
      const status = f.service.status('10');
      expect(status.hostEventsConnected).toBe(false);
      expect(status.subscriptions).toEqual([]);
      expect(status.setupError).toMatch(/subscription|setup/i);
      expect(JSON.stringify(status)).not.toContain('providerSecret');
      expect(JSON.stringify(status)).not.toContain('privateHostSession');
      await f.app.close();
    },
  );

  it('reports active types per host and removes stale readiness after close and failed recovery', async () => {
    const f = await connected();
    expect(f.service.status('10')).toMatchObject({
      hostEventsConnected: true,
      chatEventsConnected: true,
      subscriptions: ['channel.chat.message', ...hostTypes].sort(),
    });
    expect(f.service.status('other').subscriptions).toEqual([]);
    f.sockets[0]!.status = 'reconnecting';
    expect(f.service.status('10')).toMatchObject({
      hostEventsConnected: false,
      chatEventsConnected: true,
      subscriptions: ['channel.chat.message'],
    });
    expect(f.service.status('10').setupError).toMatch(/reconnecting/);
    const fetcher = f.fetcher.getMockImplementation()!;
    f.fetcher.mockRejectedValue(new Error('providerSecret'));
    await f.sockets[0]!.options.onSession('newHostSession', { reconnected: false });
    expect(f.service.status('10').hostEventsConnected).toBe(false);
    f.fetcher.mockImplementation(fetcher);
    await f.sockets[0]!.options.onSession('healthyHostSession', { reconnected: false });
    expect(f.service.status('10').hostEventsConnected).toBe(true);
    f.sockets[1]!.status = 'reconnecting';
    expect(f.service.status('10').chatEventsConnected).toBe(false);
    expect(f.service.status('10').subscriptions).toEqual(hostTypes);
    await f.sockets[1]!.options.onSession('newBotSession', { reconnected: false });
    expect(f.service.status('10').chatEventsConnected).toBe(true);
    expect(f.service.status('10').setupError).toBeUndefined();
    await f.app.close();
  });

  it('preserves confirmed subscriptions across migration and removes them on revocation', async () => {
    const f = await connected();
    const calls = f.fetcher.mock.calls.length;
    await f.sockets[0]!.options.onSession('migratedHost', { reconnected: true });
    await f.sockets[1]!.options.onSession('migratedBot', { reconnected: true });
    expect(f.fetcher.mock.calls).toHaveLength(calls);
    expect(f.service.status('10').hostEventsConnected).toBe(true);
    expect(f.service.status('10').chatEventsConnected).toBe(true);
    await f.sockets[1]!.options.onRevocation?.({ ...revocation, type: 'channel.chat.message' });
    expect(f.service.status('10')).toMatchObject({
      botConnected: false,
      chatEventsConnected: false,
      subscriptions: hostTypes,
    });
    await f.sockets[0]!.options.onRevocation?.(revocation);
    expect(f.service.status('10')).toMatchObject({
      hostConnected: false,
      hostEventsConnected: false,
      subscriptions: [],
    });
    expect(f.service.status('10').setupError).toMatch(/revoked/);
    await f.app.close();
  });

  it('counts actual received notifications without disclosing text, IDs, or session metadata', async () => {
    const f = await connected();
    const event = {
      type: 'chat' as const,
      id: 'privateMessage',
      occurredAt: 1_798_000_000_000,
      channelId: '10',
      userId: 'privateViewer',
      login: 'privateLogin',
      displayName: 'privateName',
      messageId: 'privateMessage',
      text: 'privateChatText',
    };
    await f.sockets[1]!.options.onNotification(event);
    await f.sockets[1]!.options.onNotification({ ...event, channelId: 'other' });
    f.setNow(1_798_000_000_100);
    await f.sockets[0]!.options.onNotification({
      type: 'shared',
      id: 'privateEvent',
      occurredAt: 1_798_000_000_000,
      phase: 'begin',
      sessionId: 'privateSharedSession',
      channelId: '10',
      hostBroadcasterId: '10',
      participants: ['10', 'privateParticipant'],
    });
    const status = f.service.status('10');
    expect(status.eventCount).toBe(2);
    expect(status.lastEvent).toEqual({ type: 'shared', atMs: 1_798_000_000_100 });
    expect(JSON.stringify(status)).not.toContain('private');
    f.sockets[0]!.options.onError?.(new Error('providerSecret'));
    expect(f.service.status('10').setupError).not.toContain('providerSecret');
    await f.app.close();
    expect(f.service.status('10')).toMatchObject({
      hostEventsConnected: false,
      chatEventsConnected: false,
      subscriptions: [],
      eventCount: 0,
    });
  });
});
