import { describe, expect, it } from 'vitest';
import { decodeNotification } from '../src/events.js';
import { SubscriptionPlan, TwitchWrites } from '../src/writes.js';

const metadata = {
  message_id: 'event',
  message_type: 'notification',
  message_timestamp: '2026-10-31T10:00:00Z',
};

describe('Twitch notifications and descriptors', () => {
  it('retains Shared Chat source identity on chat events', () => {
    const notification = decodeNotification({
      metadata,
      payload: {
        subscription: { type: 'channel.chat.message' },
        event: {
          broadcaster_user_id: 'host',
          chatter_user_id: 'viewer',
          chatter_user_login: 'viewerlogin',
          chatter_user_name: 'Viewer',
          message_id: 'chat1',
          message: { text: 'PUSH' },
          source_broadcaster_user_id: 'raider',
        },
      },
    });
    expect(notification).toMatchObject({
      type: 'chat',
      channelId: 'host',
      userId: 'viewer',
      sourceBroadcasterId: 'raider',
      text: 'PUSH',
      messageId: 'chat1',
    });
  });

  it('normalizes Shared Chat lifecycle and retains participants', () => {
    const notification = decodeNotification({
      metadata,
      payload: {
        subscription: { type: 'channel.shared_chat.begin' },
        event: {
          session_id: 'shared',
          broadcaster_user_id: 'host',
          host_broadcaster_user_id: 'host',
          participants: [{ broadcaster_user_id: 'host' }, { broadcaster_user_id: 'raider' }],
        },
      },
    });
    expect(notification).toMatchObject({
      type: 'shared',
      phase: 'begin',
      sessionId: 'shared',
      participants: ['host', 'raider'],
    });
  });

  it('drops unrelated event types but rejects malformed relevant ones', () => {
    expect(
      decodeNotification({
        metadata,
        payload: { subscription: { type: 'stream.online' }, event: {} },
      }),
    ).toBeNull();
    expect(() =>
      decodeNotification({
        metadata,
        payload: { subscription: { type: 'channel.raid' }, event: { viewers: -1 } },
      }),
    ).toThrow();
  });

  it('builds channel-specific subscriptions without performing network writes', () => {
    const subscriptions = SubscriptionPlan.host('session', 'host', 'bot', {
      rewards: true,
      rosterChannelId: 'raider',
    });
    expect(subscriptions).toHaveLength(7);
    expect(subscriptions[0]).toEqual({
      method: 'POST',
      path: '/eventsub/subscriptions',
      body: {
        type: 'channel.raid',
        version: '1',
        condition: { to_broadcaster_user_id: 'host' },
        transport: { method: 'websocket', session_id: 'session' },
      },
    });
    expect(
      subscriptions
        .filter((item) => item.body?.type === 'channel.chat.message')
        .map((item) => item.body?.condition),
    ).toEqual([
      { broadcaster_user_id: 'host', user_id: 'bot' },
      { broadcaster_user_id: 'raider', user_id: 'bot' },
    ]);
  });

  it('uses Twitch v1 chat and shoutout payloads', () => {
    expect(TwitchWrites.chat('host', 'bot', 'A challenge begins.')).toEqual({
      method: 'POST',
      path: '/chat/messages',
      body: { broadcaster_id: 'host', sender_id: 'bot', message: 'A challenge begins.' },
    });
    expect(TwitchWrites.shoutout('host', 'raider', 'mod')).toEqual({
      method: 'POST',
      path: '/chat/shoutouts',
      query: { from_broadcaster_id: 'host', to_broadcaster_id: 'raider', moderator_id: 'mod' },
    });
  });
});
