import type { ActionRequest } from './models.js';
import { record } from './validation.js';

const types: Record<string, string> = {
  'channel.raid': 'to_broadcaster_user_id',
  'channel.chat.message': 'broadcaster_user_id',
  'channel.shared_chat.begin': 'broadcaster_user_id',
  'channel.shared_chat.update': 'broadcaster_user_id',
  'channel.shared_chat.end': 'broadcaster_user_id',
  'channel.channel_points_custom_reward_redemption.add': 'broadcaster_user_id',
};

export function validSubscription(req: ActionRequest): boolean {
  const subscription = record(req.payload.subscription);
  const type = subscription.type;
  const condition = record(subscription.condition);
  const transport = record(subscription.transport);
  const actorId = req.actor.twitchUserId;
  const botId = req.payload.botUserId;
  if (!actorId || !['host', 'system'].includes(req.actor.kind)) return false;
  if (actorId !== req.channel.hostId && actorId !== botId) return false;
  if (typeof type !== 'string' || !Object.hasOwn(types, type) || subscription.version !== '1')
    return false;
  const field = types[type];
  if (!field || condition[field] !== req.channel.hostId) return false;
  if (
    type === 'channel.chat.message' &&
    condition.user_id !== actorId &&
    condition.user_id !== botId
  )
    return false;
  return (
    transport.method === 'websocket' &&
    typeof transport.session_id === 'string' &&
    transport.session_id.length > 0
  );
}
