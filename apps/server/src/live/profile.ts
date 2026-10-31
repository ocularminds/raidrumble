import {
  HelixReader,
  type ChannelInfo,
  type RaidNotification,
  type TokenSession,
  type TwitchIdentity,
  type TwitchUser,
} from '@raidrumble/twitch';
import type { LiveAccount, LiveOptions, LiveProfile, LiveRaid } from './model.js';

export function reader(options: LiveOptions, tokens: TokenSession): HelixReader {
  return new HelixReader({
    clientId: options.clientId ?? '',
    accessToken: () => tokens.accessToken(),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

export function profile(
  id: string,
  login: string,
  channel?: ChannelInfo,
  user?: TwitchUser,
): LiveProfile {
  return {
    id,
    login,
    name: channel?.broadcaster_name ?? user?.display_name ?? login,
    category: channel?.game_name ?? '',
    title: channel?.title ?? '',
    tags: channel?.tags ?? [],
    facts: [],
    affiliate: user?.broadcaster_type === 'affiliate' || user?.broadcaster_type === 'partner',
  };
}

export async function loadProfile(
  options: LiveOptions,
  identity: TwitchIdentity,
  tokens: TokenSession,
): Promise<LiveProfile> {
  const helix = reader(options, tokens);
  const [users, channels] = await Promise.allSettled([
    helix.users([identity.userId]),
    helix.channels([identity.userId]),
  ]);
  return profile(
    identity.userId,
    identity.login,
    channels.status === 'fulfilled' ? channels.value[0] : undefined,
    users.status === 'fulfilled' ? users.value[0] : undefined,
  );
}

export async function enrichRaid(
  options: LiveOptions,
  host: LiveAccount,
  event: RaidNotification,
  now: number,
): Promise<LiveRaid> {
  const helix = reader(options, host.tokens);
  const [users, channels, followed] = await Promise.allSettled([
    helix.users([event.raiderId]),
    helix.channels([event.hostId, event.raiderId]),
    helix.follows(event.hostId, event.raiderId),
  ]);
  const raider =
    users.status === 'fulfilled'
      ? users.value.find((user) => user.id === event.raiderId)
      : undefined;
  const channelList = channels.status === 'fulfilled' ? channels.value : [];
  const hostChannel = channelList.find((channel) => channel.broadcaster_id === event.hostId);
  const raiderChannel = channelList.find((channel) => channel.broadcaster_id === event.raiderId);
  return {
    eventId: event.id,
    occurredAt: event.occurredAt,
    viewers: event.viewers,
    raiderLogin: event.raiderLogin,
    accountAgeDays: raider
      ? Math.max(0, Math.floor((now - Date.parse(raider.created_at)) / 86_400_000))
      : null,
    hostFollowsRaider: followed.status === 'fulfilled' ? followed.value : null,
    channels: {
      host: hostChannel
        ? { ...host.profile, ...profile(event.hostId, host.identity.login, hostChannel) }
        : host.profile,
      raider: profile(event.raiderId, event.raiderLogin, raiderChannel, raider),
    },
  };
}
