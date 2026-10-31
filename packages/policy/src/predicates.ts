import type { ActionRequest, EvaluationContext, PolicyConfig } from './models.js';
import { finite, record, string } from './validation.js';
import { validSubscription } from './subscription.js';

type Predicate = (
  request: ActionRequest,
  config: PolicyConfig,
  context: EvaluationContext,
) => boolean;
const includes = (values: string[], value: unknown) =>
  typeof value === 'string' && values.some((item) => item.toLowerCase() === value.toLowerCase());

function collabValid(req: ActionRequest): boolean {
  const participants = req.payload.participants;
  const session = req.payload.sessionParticipantIds;
  if (
    req.actor.kind !== 'host' ||
    req.actor.twitchUserId !== req.channel.hostId ||
    !Array.isArray(participants) ||
    !Array.isArray(session) ||
    !session.includes(req.channel.hostId) ||
    !session.every((id: unknown) => typeof id === 'string' && id.length > 0)
  )
    return false;
  const profiles = participants.map((value: unknown) => record(value));
  if (
    !profiles.every(
      (participant) =>
        typeof participant.id === 'string' &&
        participant.id.length > 0 &&
        typeof participant.login === 'string' &&
        participant.login.length > 0 &&
        session.includes(participant.id),
    )
  )
    return false;
  const ids = new Set(profiles.map((participant) => participant.id));
  const visitors = session.filter((id: unknown) => id !== req.channel.hostId);
  return (
    ids.size === profiles.length &&
    visitors.length > 0 &&
    visitors.every((id: unknown) => ids.has(id)) &&
    (!req.channel.raiderId || ids.has(req.channel.raiderId))
  );
}

const predicates: Record<string, Predicate> = {
  'raider in lists.block': (req, config) => includes(config.lists.block, req.payload.raiderLogin),
  'raider.accountAgeDays < params.minRaiderAccountAgeDays': (req, config) =>
    !(req.payload.factsUnavailable === true && req.payload.raiderAccountAgeDays === null) &&
    finite(req.payload.raiderAccountAgeDays) < config.params.minRaiderAccountAgeDays,
  'raid.viewers < params.minRaidSize': (req, config) =>
    finite(req.payload.raidViewers) < config.params.minRaidSize,
  'raidsFrom(raider, 60m) > params.maxRaidsPerChannelPerHour': (req, config) =>
    finite(req.payload.raidsLastHour) > config.params.maxRaidsPerChannelPerHour,
  'raid.factsUnavailable': (req) => req.payload.factsUnavailable === true,
  'raider in lists.allow': (req, config) => includes(config.lists.allow, req.payload.raiderLogin),
  'host.follows(raider)': (req) => req.payload.hostFollowsRaider === true,
  'ledger.has(host, raider)': (req) => req.payload.hasPriorMatch === true,
  'collab.invalidSession': (req) => !collabValid(req),
  'collab.allAllowed': (req, config) =>
    collabValid(req) &&
    (req.payload.participants as unknown[]).every(
      (value) =>
        record(value).id === req.channel.hostId ||
        includes(config.lists.allow, record(value).login),
    ),
  'content.blockedTerm': (req, config) => {
    const text = string(req.payload.text).normalize('NFKC').toLowerCase();
    return config.lists.blockedTerms.some(
      (term) => term.trim().length > 0 && text.includes(term.normalize('NFKC').toLowerCase()),
    );
  },
  'content.moderationFlagged': (req) => req.payload.moderationFlagged === true,
  'chat.rateLimited': (req, _config, ctx) =>
    req.payload.lastSentAt !== undefined && ctx.nowMs - finite(req.payload.lastSentAt) < 5000,
  'chat.unapprovedContent': (req, _config, ctx) => {
    if (req.payload.templated === true) return false;
    const id = req.payload.contentDecisionId;
    if (typeof id !== 'string') return true;
    const content = ctx.getRequest(id);
    return (
      ctx.getDecision(id)?.verdict !== 'ALLOW' ||
      content?.action !== 'content.render' ||
      content.channel.hostId !== req.channel.hostId ||
      content.payload.text !== req.payload.text
    );
  },
  'special.roleMismatch': (req) => {
    if (!req.matchId) return true;
    if (req.payload.special === 'ram')
      return (
        req.actor.kind !== 'warlord' ||
        !req.channel.raiderId ||
        req.actor.twitchUserId !== req.channel.raiderId
      );
    if (req.payload.special === 'oil')
      return req.actor.kind !== 'host' || req.actor.twitchUserId !== req.channel.hostId;
    if (req.payload.special === 'reinforcements')
      return (
        req.actor.kind !== 'viewer' ||
        !req.actor.twitchUserId ||
        req.actor.twitchUserId !== req.payload.redeemerId
      );
    return true;
  },
  'special.budgetExhausted': (req) => finite(req.payload.budgetRemaining) < 1,
  'special.invalidRedemption': (req) =>
    req.payload.special === 'reinforcements' &&
    (typeof req.payload.rewardId !== 'string' ||
      !req.payload.rewardId ||
      req.payload.rewardId !== req.payload.expectedRewardId ||
      req.payload.redemptionStatus !== 'fulfilled' ||
      typeof req.payload.redemptionId !== 'string' ||
      !req.payload.redemptionId),
  'shoutout.rateLimited': (req, _config, ctx) =>
    req.payload.lastSentAt !== undefined && ctx.nowMs - finite(req.payload.lastSentAt) < 3_600_000,
  'events.invalidSubscription': (req) => !validSubscription(req),
};

export const predicateNames = Object.keys(predicates);

export function evaluatePredicate(
  name: string,
  req: ActionRequest,
  config: PolicyConfig,
  context: EvaluationContext,
): boolean {
  const predicate = predicates[name];
  if (!predicate || !Object.hasOwn(predicates, name))
    throw new Error(`Unknown policy predicate: ${name}`);
  return predicate(req, config, context);
}
