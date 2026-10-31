import type { HelixWrite } from './model.js';

export class SubscriptionPlan {
  static host(
    sessionId: string,
    hostId: string,
    botId: string,
    options: { rewards?: boolean; rosterChannelId?: string } = {},
  ): HelixWrite[] {
    const descriptors = [
      this.subscription(sessionId, 'channel.raid', { to_broadcaster_user_id: hostId }),
      this.subscription(sessionId, 'channel.chat.message', {
        broadcaster_user_id: hostId,
        user_id: botId,
      }),
      ...['begin', 'update', 'end'].map((phase) =>
        this.subscription(sessionId, `channel.shared_chat.${phase}`, {
          broadcaster_user_id: hostId,
        }),
      ),
    ];
    if (options.rewards)
      descriptors.push(
        this.subscription(sessionId, 'channel.channel_points_custom_reward_redemption.add', {
          broadcaster_user_id: hostId,
        }),
      );
    if (options.rosterChannelId && options.rosterChannelId !== hostId)
      descriptors.push(
        this.subscription(sessionId, 'channel.chat.message', {
          broadcaster_user_id: options.rosterChannelId,
          user_id: botId,
        }),
      );
    return descriptors;
  }

  static subscription(
    sessionId: string,
    type: string,
    condition: Record<string, string>,
  ): HelixWrite {
    return {
      method: 'POST',
      path: '/eventsub/subscriptions',
      body: {
        type,
        version: '1',
        condition,
        transport: { method: 'websocket', session_id: sessionId },
      },
    };
  }
}

export class TwitchWrites {
  static chat(broadcasterId: string, senderId: string, message: string): HelixWrite {
    return {
      method: 'POST',
      path: '/chat/messages',
      body: { broadcaster_id: broadcasterId, sender_id: senderId, message },
    };
  }

  static shoutout(
    fromBroadcasterId: string,
    toBroadcasterId: string,
    moderatorId: string,
  ): HelixWrite {
    return {
      method: 'POST',
      path: '/chat/shoutouts',
      query: {
        from_broadcaster_id: fromBroadcasterId,
        to_broadcaster_id: toBroadcasterId,
        moderator_id: moderatorId,
      },
    };
  }

  static reward(broadcasterId: string, title: string, cost: number, rewardId?: string): HelixWrite {
    return {
      method: rewardId ? 'PATCH' : 'POST',
      path: '/channel_points/custom_rewards',
      query: { broadcaster_id: broadcasterId, ...(rewardId ? { id: rewardId } : {}) },
      body: {
        title,
        cost,
        is_enabled: true,
        is_max_per_user_per_stream_enabled: true,
        max_per_user_per_stream: 1,
      },
    };
  }
}
