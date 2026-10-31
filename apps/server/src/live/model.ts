import type { ChannelProfile, Channels } from '@raidrumble/content';
import type { PolicyGate } from '@raidrumble/policy';
import type {
  ChatNotification,
  EventSubOptions,
  OAuthTokens,
  RedemptionNotification,
  TokenSession,
  TwitchIdentity,
} from '@raidrumble/twitch';

export interface LiveProfile extends ChannelProfile {
  login: string;
  affiliate: boolean;
}

/** Unknown policy facts are null: callers must not turn failed reads into trust. */
export interface LiveRaid {
  eventId: string;
  occurredAt: number;
  viewers: number;
  raiderLogin: string;
  accountAgeDays: number | null;
  hostFollowsRaider: boolean | null;
  channels: Channels;
}

export interface LiveClient {
  readonly status?: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopped';
  start(): void;
  stop(): void;
}

export interface LiveOptions {
  clientId?: string;
  clientSecret?: string;
  botUserId?: string;
  redirectUri?: string;
  baseUrl: string;
  dashboardUrl: string;
  onHost: (profile: LiveProfile) => void | Promise<void>;
  onRaid: (hostId: string, raid: LiveRaid) => void | Promise<void>;
  onChat: (hostId: string, event: ChatNotification) => void | Promise<void>;
  onShared: (hostId: string, participants: string[]) => void | Promise<void>;
  onRedemption?: (hostId: string, event: RedemptionNotification) => void | Promise<void>;
  onRoster?: (raiderId: string, event: ChatNotification) => void | Promise<void>;
  getGate: (hostId: string) => PolicyGate;
  onError?: (hostId: string, message: string) => void;
  fetch?: typeof fetch;
  createEventSub?: (options: EventSubOptions) => LiveClient;
  now?: () => number;
}

export interface LiveStatus {
  configured: boolean;
  hostConnected: boolean;
  botConnected: boolean;
  hostEventsConnected: boolean;
  chatEventsConnected: boolean;
  subscriptions: string[];
  eventCount: number;
  lastEvent?: { type: 'raid' | 'chat' | 'shared' | 'redemption'; atMs: number };
  setupError?: string;
}

export interface LiveAccount {
  identity: TwitchIdentity;
  profile: LiveProfile;
  tokens: TokenSession;
  revoked: boolean;
}

export interface WarlordTarget {
  hostId: string;
  raiderId: string;
  matchId: string;
  expiresAt: number;
}

export interface WarlordLink {
  token: string;
  url: string;
  loginUrl: string;
}

export interface AuthenticatedLogin {
  identity: TwitchIdentity;
  tokens: OAuthTokens;
}
