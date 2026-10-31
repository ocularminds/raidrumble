import { isDeepStrictEqual } from 'node:util';
import type { ActionRequest, HelixWrite } from './models.js';

export function matchesWrite(req: ActionRequest, write: HelixWrite): boolean {
  if (
    !write.path.startsWith('/') ||
    write.path.includes('?') ||
    write.path.includes('#') ||
    write.path.includes('..')
  )
    return false;
  const body = write.body ?? {};
  const query = write.query ?? {};
  switch (req.action) {
    case 'events.subscribe':
      return (
        write.method === 'POST' &&
        write.path === '/eventsub/subscriptions' &&
        isDeepStrictEqual(body, req.payload.subscription) &&
        Object.keys(query).length === 0
      );
    case 'chat.send':
      return (
        write.method === 'POST' &&
        write.path === '/chat/messages' &&
        body.broadcaster_id === req.channel.hostId &&
        body.sender_id === req.actor.twitchUserId &&
        typeof req.actor.twitchUserId === 'string' &&
        body.message === req.payload.text
      );
    case 'shoutout.send':
      return (
        write.method === 'POST' &&
        write.path === '/chat/shoutouts' &&
        query.from_broadcaster_id === req.channel.hostId &&
        query.to_broadcaster_id === req.channel.raiderId &&
        query.moderator_id === req.actor.twitchUserId &&
        typeof req.actor.twitchUserId === 'string'
      );
    case 'rewards.configure':
      return (
        write.path === '/channel_points/custom_rewards' &&
        query.broadcaster_id === req.channel.hostId &&
        isDeepStrictEqual(req.payload.write, write)
      );
    default:
      return false;
  }
}

export function helixBase(value = 'https://api.twitch.tv/helix'): URL {
  const url = new URL(value);
  const official =
    url.origin === 'https://api.twitch.tv' && url.pathname.replace(/\/$/, '') === '/helix';
  const loopback =
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
    ['http:', 'https:'].includes(url.protocol);
  if ((!official && !loopback) || url.username || url.password || url.search || url.hash)
    throw new Error('Invalid Helix API base');
  return url;
}
