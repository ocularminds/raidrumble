import type { ActionPolicy, FailureRule, PolicyConfig, Verdict } from './models.js';

function rule(verdict: Verdict, reason: string, onFailure: FailureRule): ActionPolicy {
  return { block: [], allow: [], otherwise: { verdict, reason }, onFailure };
}

export function defaultPolicy(): PolicyConfig {
  return {
    version: 1,
    defaults: { mode: 'shadow', latencyBudgetMs: 120 },
    lists: { allow: [], block: [], blockedTerms: [] },
    params: {
      minRaidSize: 3,
      minRaiderAccountAgeDays: 7,
      maxRaidsPerChannelPerHour: 2,
      escalateTimeoutMs: 10_000,
    },
    actions: {
      'rumble.start': {
        block: [
          { when: 'raider in lists.block', reason: 'RAIDER_BLOCKLISTED' },
          {
            when: 'raider.accountAgeDays < params.minRaiderAccountAgeDays',
            reason: 'RAIDER_ACCOUNT_TOO_NEW',
          },
          { when: 'raid.viewers < params.minRaidSize', reason: 'RAID_TOO_SMALL' },
          {
            when: 'raidsFrom(raider, 60m) > params.maxRaidsPerChannelPerHour',
            reason: 'RAID_FLOOD',
          },
        ],
        escalate: [{ when: 'raid.factsUnavailable', reason: 'RAID_FACTS_UNAVAILABLE' }],
        allow: [
          { when: 'raider in lists.allow', reason: 'RAIDER_ALLOWLISTED' },
          { when: 'host.follows(raider)', reason: 'HOST_FOLLOWS_RAIDER' },
          { when: 'ledger.has(host, raider)', reason: 'KNOWN_RIVAL' },
        ],
        otherwise: { verdict: 'ESCALATE', reason: 'UNKNOWN_RAIDER', approver: 'host' },
        onFailure: 'ESCALATE',
      },
      'rumble.start.collab': {
        ...rule('ESCALATE', 'COLLAB_PARTICIPANT_UNTRUSTED', 'ESCALATE'),
        block: [{ when: 'collab.invalidSession', reason: 'COLLAB_INVALID_SESSION' }],
        allow: [{ when: 'collab.allAllowed', reason: 'COLLAB_ALLOWED' }],
      },
      'content.render': {
        ...rule('ALLOW', 'CONTENT_SAFE', 'TEMPLATE'),
        block: [
          { when: 'content.blockedTerm', reason: 'BLOCKED_TERM' },
          { when: 'content.moderationFlagged', reason: 'MODERATION_FLAGGED' },
        ],
      },
      'chat.send': {
        ...rule('ALLOW', 'CHAT_ALLOWED', 'SKIP'),
        block: [
          { when: 'chat.rateLimited', reason: 'CHAT_RATE_LIMIT' },
          { when: 'chat.unapprovedContent', reason: 'CHAT_CONTENT_UNAPPROVED' },
        ],
      },
      'special.fire': {
        ...rule('ALLOW', 'SPECIAL_ALLOWED', 'BLOCK'),
        block: [
          { when: 'special.roleMismatch', reason: 'SPECIAL_ROLE_MISMATCH' },
          { when: 'special.budgetExhausted', reason: 'SPECIAL_BUDGET_EXHAUSTED' },
          { when: 'special.invalidRedemption', reason: 'REINFORCEMENT_REDEMPTION_INVALID' },
        ],
      },
      'rewards.configure': rule('ESCALATE', 'REWARD_SETUP_APPROVAL', 'BLOCK'),
      'shoutout.send': {
        ...rule('ALLOW', 'SHOUTOUT_ALLOWED', 'SKIP'),
        block: [{ when: 'shoutout.rateLimited', reason: 'SHOUTOUT_RATE_LIMIT' }],
      },
      'ledger.settle': rule('ALLOW', 'LEDGER_SETTLEMENT', 'LOCAL'),
      'events.subscribe': {
        ...rule('ALLOW', 'EVENTS_SUBSCRIPTION_ALLOWED', 'BLOCK'),
        block: [{ when: 'events.invalidSubscription', reason: 'EVENTS_SUBSCRIPTION_INVALID' }],
      },
    },
  };
}
