import type { SpecialEffect } from '@raidrumble/engine';
import { PolicyExecutor, type ActionRequest, type PolicyGate } from '@raidrumble/policy';

export type HostSpecial = 'ram' | 'oil';

export interface SpecialOptions {
  hostId: string;
  raiderId: string;
  matchId: string;
  now?: () => number;
}

export interface RewardRedemption {
  userId: string;
  rewardId: string;
  status: string;
  redemptionId: string;
}

export interface SpecialBudgets {
  readonly ram: 0 | 1;
  readonly oil: 0 | 1;
  readonly reinforcedUsers: number;
}

/** One instance per match. Browser input must never be used as a redemption source. */
export class SpecialService {
  private readonly hostId: string;
  private readonly raiderId: string;
  private readonly matchId: string;
  private readonly now: () => number;
  private readonly executor: PolicyExecutor;
  private readonly usedSpecials = new Set<HostSpecial>();
  private readonly usedViewers = new Set<string>();
  private readonly usedRedemptions = new Set<string>();
  private readonly pending = new Set<string>();
  private readonly active: SpecialEffect[] = [];

  constructor(
    private readonly gate: PolicyGate,
    options: SpecialOptions,
  ) {
    if (!options.hostId || !options.raiderId || !options.matchId)
      throw new Error('Specials require a channel pair and match');
    this.hostId = options.hostId;
    this.raiderId = options.raiderId;
    this.matchId = options.matchId;
    this.now = options.now ?? Date.now;
    this.executor = new PolicyExecutor(gate);
  }

  get budgets(): SpecialBudgets {
    const available = (special: HostSpecial): 0 | 1 =>
      this.usedSpecials.has(special) || this.pending.has(`special:${special}`) ? 0 : 1;
    return { ram: available('ram'), oil: available('oil'), reinforcedUsers: this.usedViewers.size };
  }

  async fire(actorId: string, special: HostSpecial): Promise<SpecialEffect | undefined> {
    if (special !== 'ram' && special !== 'oil') return undefined;
    const expected = special === 'ram' ? this.raiderId : this.hostId;
    const key = `special:${special}`;
    if (actorId !== expected || this.usedSpecials.has(special) || !this.reserve([key]))
      return undefined;
    try {
      return await this.run(
        { kind: special === 'ram' ? 'warlord' : 'host', twitchUserId: actorId },
        { special, budgetRemaining: 1 },
        () => {
          const effect = this.effect(special, 5000);
          this.usedSpecials.add(special);
          this.active.push(effect);
          return { ...effect };
        },
      );
    } finally {
      this.pending.delete(key);
    }
  }

  async reinforce(
    source: RewardRedemption,
    configuredRewardId: string,
  ): Promise<SpecialEffect | undefined> {
    const event = { ...source };
    if (
      !event.userId ||
      !event.redemptionId ||
      !configuredRewardId ||
      event.rewardId !== configuredRewardId ||
      event.status !== 'fulfilled' ||
      this.usedViewers.has(event.userId) ||
      this.usedRedemptions.has(event.redemptionId)
    )
      return undefined;
    const keys = [`viewer:${event.userId}`, `redemption:${event.redemptionId}`];
    if (!this.reserve(keys)) return undefined;
    try {
      return await this.run(
        { kind: 'viewer', twitchUserId: event.userId },
        {
          special: 'reinforcements',
          budgetRemaining: 1,
          rewardId: event.rewardId,
          expectedRewardId: configuredRewardId,
          redemptionStatus: event.status,
          redemptionId: event.redemptionId,
          redeemerId: event.userId,
        },
        () => {
          const effect = this.effect('reinforcements', 10_000, event.userId);
          this.usedViewers.add(event.userId);
          this.usedRedemptions.add(event.redemptionId);
          this.active.push(effect);
          return { ...effect };
        },
      );
    } finally {
      for (const key of keys) this.pending.delete(key);
    }
  }

  effects(nowMs = this.now()): readonly SpecialEffect[] {
    if (!Number.isFinite(nowMs)) return [];
    return this.active
      .filter((effect) => effect.startsAtMs <= nowMs && nowMs < effect.endsAtMs)
      .map((effect) => ({ ...effect }));
  }

  weight(userId: string, nowMs = this.now()): number {
    return this.effects(nowMs).some(
      (effect) => effect.id === 'reinforcements' && effect.userId === userId,
    )
      ? 2
      : 1;
  }

  private reserve(keys: string[]): boolean {
    if (keys.some((key) => this.pending.has(key))) return false;
    for (const key of keys) this.pending.add(key);
    return true;
  }

  private effect(id: SpecialEffect['id'], durationMs: number, userId?: string): SpecialEffect {
    const startsAtMs = this.now();
    if (!Number.isFinite(startsAtMs)) throw new Error('Invalid match clock');
    return {
      id,
      startsAtMs,
      endsAtMs: startsAtMs + durationMs,
      ...(userId === undefined ? {} : { userId }),
    };
  }

  private async run(
    actor: ActionRequest['actor'],
    payload: ActionRequest['payload'],
    effect: () => SpecialEffect,
  ): Promise<SpecialEffect | undefined> {
    try {
      const decision = await this.gate.authorize({
        action: 'special.fire',
        actor,
        channel: { hostId: this.hostId, raiderId: this.raiderId },
        matchId: this.matchId,
        payload,
      });
      // Operational failure uses special.fire's BLOCK fallback in both modes.
      if (decision.reasonCodes.some((code) => code === 'POLICY_TIMEOUT' || code === 'POLICY_ERROR'))
        return undefined;
      const result = await this.executor.execute(decision, effect);
      return result.executed ? result.value : undefined;
    } catch {
      return undefined;
    }
  }
}
