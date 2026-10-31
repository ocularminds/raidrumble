import type { DashboardView } from '../../server/src/model.js';

const reasons: Record<string, string> = {
  RAIDER_BLOCKLISTED: 'On your blocked list',
  RAIDER_ACCOUNT_TOO_NEW: 'Account is less than 7 days old',
  UNKNOWN_RAIDER: 'Not on your trusted list: asked you',
  RAID_FLOOD: 'Too many raids from this channel this hour',
  RAID_TOO_SMALL: 'Raid is below your minimum size',
  RAID_FACTS_UNAVAILABLE: 'Twitch details were unavailable: asked you',
  RAIDER_ALLOWLISTED: 'On your trusted list',
  HOST_FOLLOWS_RAIDER: 'You follow this channel',
  KNOWN_RIVAL: 'Your communities have played before',
  COLLAB_ALLOWED: 'Your trusted communities are sharing chat',
  COLLAB_INVALID_SESSION: 'Shared Chat membership could not be confirmed',
  COLLAB_PARTICIPANT_UNTRUSTED: 'A Shared Chat participant needs your approval',
  SPECIAL_ALLOWED: 'The right streamer has a special available',
  SPECIAL_BUDGET_EXHAUSTED: 'This special has already been used',
  SPECIAL_ROLE_MISMATCH: 'This special belongs to the other streamer',
  REINFORCEMENT_REDEMPTION_INVALID: 'The Reinforcements redemption could not be verified',
  REWARD_SETUP_APPROVAL: 'Your approval is needed to create this reward',
  CHAT_RATE_LIMIT: 'Chat announcements are limited to one every 5 seconds',
  SHOUTOUT_RATE_LIMIT: 'This channel already received a shoutout this hour',
  POLICY_TIMEOUT: 'The policy check took too long: safe fallback applied',
  POLICY_ERROR: 'The policy check was unavailable: safe fallback applied',
  HOST_APPROVED: 'You accepted this challenge',
  APPROVAL_EXPIRED: 'The approval window expired',
  APPROVAL_DENIED: 'The challenge was declined',
  APPROVAL_REQUIRED: 'Waiting for your approval',
  CONTENT_SAFE: 'Content passed your stream rules',
  BLOCKED_TERM: 'Contains a word kept off your overlay',
  MODERATION_FLAGGED: 'Content needs moderation',
  CHAT_ALLOWED: 'Stream message passed your rules',
  CHAT_CONTENT_UNAPPROVED: 'The message has not passed your content rules',
  SHOUTOUT_ALLOWED: 'This community is ready for a shoutout',
  LEDGER_SETTLEMENT: 'Community results saved',
  EVENTS_SUBSCRIPTION_ALLOWED: 'Twitch event connection approved',
  EVENTS_SUBSCRIPTION_INVALID: 'Twitch connection could not be verified',
  CONTENT_TEMPLATE_FALLBACK: 'Using a ready-made question instead',
  MESSAGE_SKIPPED: 'This message was skipped',
  ACTION_BLOCKED: 'Your stream rules stopped this action',
  UNSIGNED_LEDGER_FALLBACK: 'Community results saved locally',
};

export function reasonText(code: string): string {
  return reasons[code] ?? 'Policy decision recorded';
}

export function plural(
  count: number,
  noun: string,
  multiple = noun + (noun === noun.toUpperCase() ? 'S' : 's'),
): string {
  return `${count} ${count === 1 ? noun : multiple}`;
}

export function avatar(hostId: string, name: string): string {
  return hostId === 'demo' ? '▲' : (Array.from(name.trim())[0]?.toUpperCase() ?? '●');
}

export function channelLabel(channel: { id: string; name?: string }, index: number): string {
  const name = channel.name?.trim();
  return name && name !== channel.id && !/^Channel \d+$/.test(name)
    ? name
    : `Rival Community ${index + 1}`;
}

export function twitchSummary(twitch: DashboardView['twitch']): string {
  if (!twitch.configured)
    return "Live mode isn't set up on this server yet. See the README's Go live section.";
  return [
    twitch.hostConnected ? 'Host connected' : 'Host not connected',
    twitch.botConnected ? 'Bot connected' : 'Bot not connected',
    ...(twitch.hostConnected
      ? [twitch.hostEventsConnected ? 'Raid events ready' : 'Raid events pending']
      : []),
    ...(twitch.botConnected ? [twitch.chatEventsConnected ? 'Chat ready' : 'Chat pending'] : []),
    ...(twitch.eventCount ? [`${plural(twitch.eventCount, 'event')} received`] : []),
    ...(twitch.setupError ? [twitch.setupError] : []),
  ].join(' · ');
}

export interface WarlordView {
  authorized: boolean;
  active: boolean;
  available: boolean;
  loginUrl: string;
  raiderName: string;
  simulated: boolean;
  matchId?: string;
}

export function warlordState(view: WarlordView, pending = false, used = false) {
  const spent = used || (view.authorized && view.active && !view.available);
  return {
    label: spent ? 'RAM USED ✓' : pending ? 'FIRING…' : 'FIRE BATTERING RAM',
    disabled: spent || !view.authorized || !view.active || !view.available || pending,
    message: !view.authorized
      ? 'Your Twitch identity must match the raiding streamer.'
      : spent
        ? 'Battering Ram used. Rally your Raiders!'
        : !view.active
          ? 'Your Battering Ram is available during Siege.'
          : 'Your Battering Ram is ready.',
  };
}
