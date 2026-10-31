import type { EventIdentity, TwitchNotification } from './model.js';
import { count, identifier, record, text, timestamp } from './parse.js';

export interface EventFrame {
  metadata: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export function parseFrame(value: unknown): EventFrame {
  const frame = record(value, 'EventSub message');
  const metadata = record(frame.metadata, 'EventSub metadata');
  identifier(metadata.message_id, 'message ID');
  identifier(metadata.message_type, 'message type');
  timestamp(metadata.message_timestamp);
  return { metadata, payload: record(frame.payload, 'EventSub payload') };
}

/** The only ingress mapping from untrusted Twitch frames to application events. */
export function decodeNotification(value: unknown): TwitchNotification | null {
  const frame = parseFrame(value);
  const subscription = record(frame.payload.subscription, 'subscription');
  const type = text(subscription.type, 'subscription type');
  const event = record(frame.payload.event, 'event');
  const identity: EventIdentity = {
    id: identifier(frame.metadata.message_id, 'message ID'),
    occurredAt: timestamp(frame.metadata.message_timestamp),
  };
  if (type === 'channel.raid') {
    return {
      ...identity,
      type: 'raid',
      hostId: identifier(event.to_broadcaster_user_id, 'raid host ID'),
      hostLogin: text(event.to_broadcaster_user_login, 'raid host login'),
      hostName: text(event.to_broadcaster_user_name, 'raid host name'),
      raiderId: identifier(event.from_broadcaster_user_id, 'raider ID'),
      raiderLogin: text(event.from_broadcaster_user_login, 'raider login'),
      raiderName: text(event.from_broadcaster_user_name, 'raider name'),
      viewers: count(event.viewers, 'raid viewers'),
    };
  }
  if (type === 'channel.chat.message') {
    const message = record(event.message, 'chat message');
    const source = event.source_broadcaster_user_id;
    if (source !== undefined && source !== null && typeof source !== 'string')
      throw new Error('Invalid Twitch chat source');
    return {
      ...identity,
      type: 'chat',
      channelId: identifier(event.broadcaster_user_id, 'chat channel ID'),
      userId: identifier(event.chatter_user_id, 'chatter ID'),
      login: text(event.chatter_user_login, 'chatter login'),
      displayName: text(event.chatter_user_name, 'chatter name'),
      messageId: identifier(event.message_id, 'chat message ID'),
      text: text(message.text, 'chat text'),
      ...(typeof source === 'string' && source ? { sourceBroadcasterId: source } : {}),
    };
  }
  if (
    type === 'channel.shared_chat.begin' ||
    type === 'channel.shared_chat.update' ||
    type === 'channel.shared_chat.end'
  ) {
    const phase =
      type === 'channel.shared_chat.begin'
        ? 'begin'
        : type === 'channel.shared_chat.update'
          ? 'update'
          : 'end';
    const participants = event.participants ?? (phase === 'end' ? [] : undefined);
    if (!Array.isArray(participants)) throw new Error('Invalid Twitch Shared Chat participants');
    return {
      ...identity,
      type: 'shared',
      phase,
      sessionId: identifier(event.session_id, 'Shared Chat session'),
      channelId: identifier(event.broadcaster_user_id, 'Shared Chat channel'),
      hostBroadcasterId: identifier(event.host_broadcaster_user_id, 'Shared Chat host'),
      participants: participants.map((participant: unknown) =>
        identifier(record(participant, 'participant').broadcaster_user_id, 'participant ID'),
      ),
    };
  }
  if (type === 'channel.channel_points_custom_reward_redemption.add') {
    const reward = record(event.reward, 'reward');
    return {
      ...identity,
      type: 'redemption',
      channelId: identifier(event.broadcaster_user_id, 'redemption channel'),
      userId: identifier(event.user_id, 'redeemer ID'),
      redemptionId: identifier(event.id, 'redemption ID'),
      rewardId: identifier(reward.id, 'reward ID'),
      status: text(event.status, 'redemption status'),
    };
  }
  return null;
}
