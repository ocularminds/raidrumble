export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  created_at: string;
  broadcaster_type: string;
}

export interface ChannelInfo {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  title: string;
  game_id: string;
  game_name: string;
  tags: string[];
}

export interface FollowedChannel {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  followed_at: string;
}

export interface Chatter {
  user_id: string;
  user_login: string;
  user_name: string;
}

export interface Page<T> {
  data: T[];
  cursor?: string;
  total?: number;
}

export interface EventIdentity {
  id: string;
  occurredAt: number;
}

export interface RaidNotification extends EventIdentity {
  type: 'raid';
  hostId: string;
  hostLogin: string;
  hostName: string;
  raiderId: string;
  raiderLogin: string;
  raiderName: string;
  viewers: number;
}

/** This model stays server-side: raw text and display names are never overlay data. */
export interface ChatNotification extends EventIdentity {
  type: 'chat';
  channelId: string;
  userId: string;
  login: string;
  displayName: string;
  messageId: string;
  text: string;
  sourceBroadcasterId?: string;
}

export interface SharedNotification extends EventIdentity {
  type: 'shared';
  phase: 'begin' | 'update' | 'end';
  sessionId: string;
  channelId: string;
  hostBroadcasterId: string;
  participants: string[];
}

export interface RedemptionNotification extends EventIdentity {
  type: 'redemption';
  channelId: string;
  userId: string;
  redemptionId: string;
  rewardId: string;
  status: string;
}

export type TwitchNotification =
  RaidNotification | ChatNotification | SharedNotification | RedemptionNotification;

export interface SubscriptionRevocation {
  id: string;
  type: string;
  status: string;
}

/** Describes a Helix side effect; only the policy executor may send it. */
export interface HelixWrite {
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

export interface TwitchIdentity {
  userId: string;
  login: string;
  scopes: string[];
  expiresIn: number;
}

export type OAuthRole = 'host' | 'bot' | 'raider' | 'warlord';

export interface OAuthState {
  browserId: string;
  role: OAuthRole;
  expectedUserId?: string;
}
