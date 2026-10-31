import { describe, expect, it, vi } from 'vitest';
import { defaultPolicy, LocalPolicyGate, type PolicyMode } from '@raidrumble/policy';
import { SpecialService } from '../src/services/specials.js';

function setup(mode: PolicyMode = 'enforce') {
  let time = 0;
  const config = defaultPolicy();
  config.defaults.mode = mode;
  const gate = new LocalPolicyGate(config, { now: () => time, logger: () => undefined });
  const service = new SpecialService(gate, {
    hostId: 'host',
    raiderId: 'raider',
    matchId: 'match',
    now: () => time,
  });
  return {
    gate,
    service,
    setTime: (next: number) => {
      time = next;
    },
  };
}

const redemption = {
  userId: 'viewer',
  rewardId: 'reward',
  status: 'fulfilled',
  redemptionId: 'redemption',
};

describe.each<PolicyMode>(['shadow', 'enforce'])('match specials in %s mode', (mode) => {
  it('binds ram and oil to the exact channel role and gates each accepted effect', async () => {
    const { gate, service } = setup(mode);
    const spy = vi.spyOn(gate, 'authorize');
    expect(await service.fire('host', 'ram')).toBeUndefined();
    expect(await service.fire('raider', 'oil')).toBeUndefined();
    expect(await service.fire('stranger', 'ram')).toBeUndefined();
    expect(await service.fire('raider', 'ram')).toEqual({
      id: 'ram',
      startsAtMs: 0,
      endsAtMs: 5000,
    });
    expect(await service.fire('host', 'oil')).toEqual({ id: 'oil', startsAtMs: 0, endsAtMs: 5000 });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      action: 'special.fire',
      actor: { kind: 'warlord', twitchUserId: 'raider' },
      matchId: 'match',
    });
  });

  it('caps each role at one use even after the effect expires', async () => {
    const { service, setTime } = setup(mode);
    await service.fire('raider', 'ram');
    expect(service.budgets).toEqual({ ram: 0, oil: 1, reinforcedUsers: 0 });
    setTime(5000);
    expect(service.effects()).toEqual([]);
    expect(await service.fire('raider', 'ram')).toBeUndefined();
    expect(await service.fire('host', 'oil')).toBeDefined();
  });

  it('reserves the budget synchronously when concurrent requests race', async () => {
    const { gate, service } = setup(mode);
    const authorize = gate.authorize.bind(gate);
    let release: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(gate, 'authorize').mockImplementation(async (request) => {
      await waiting;
      return authorize(request);
    });
    const first = service.fire('raider', 'ram');
    expect(service.budgets.ram).toBe(0);
    expect(await service.fire('raider', 'ram')).toBeUndefined();
    release();
    expect(await first).toBeDefined();
    expect(service.effects()).toHaveLength(1);
  });

  it('returns effect copies and respects the inclusive start and exclusive expiry', async () => {
    const { service, setTime } = setup(mode);
    setTime(1000);
    await service.fire('raider', 'ram');
    expect(service.effects(999)).toEqual([]);
    expect(service.effects(1000)).toHaveLength(1);
    expect(service.effects(5999)).toHaveLength(1);
    expect(service.effects(6000)).toEqual([]);
    expect(service.effects(Number.NaN)).toEqual([]);
    const copy = service.effects(1000)[0];
    if (copy) Object.assign(copy, { endsAtMs: 99999 });
    expect(service.effects(6000)).toEqual([]);
  });

  it('only activates a completed redemption for the configured reward', async () => {
    const { gate, service } = setup(mode);
    const spy = vi.spyOn(gate, 'authorize');
    expect(await service.reinforce({ ...redemption, rewardId: 'other' }, 'reward')).toBeUndefined();
    expect(
      await service.reinforce({ ...redemption, status: 'canceled' }, 'reward'),
    ).toBeUndefined();
    expect(
      await service.reinforce({ ...redemption, status: 'unfulfilled' }, 'reward'),
    ).toBeUndefined();
    expect(
      await service.reinforce({ ...redemption, status: 'FULFILLED' }, 'reward'),
    ).toBeUndefined();
    expect(await service.reinforce(redemption, '')).toBeUndefined();
    expect(service.weight('viewer', 0)).toBe(1);
    expect(await service.reinforce(redemption, 'reward')).toEqual({
      id: 'reinforcements',
      userId: 'viewer',
      startsAtMs: 0,
      endsAtMs: 10000,
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0].payload).toMatchObject({
      special: 'reinforcements',
      rewardId: 'reward',
      expectedRewardId: 'reward',
      redemptionStatus: 'fulfilled',
      redeemerId: 'viewer',
    });
  });

  it('grants +1 weight for ten seconds and caps the redeemer at one use per match', async () => {
    const { service } = setup(mode);
    await service.reinforce(redemption, 'reward');
    expect(service.weight('viewer', 0)).toBe(2);
    expect(service.weight('viewer', 9999)).toBe(2);
    expect(service.weight('viewer', 10000)).toBe(1);
    expect(service.weight('other', 0)).toBe(1);
    expect(
      await service.reinforce({ ...redemption, redemptionId: 'another' }, 'reward'),
    ).toBeUndefined();
    expect(service.budgets.reinforcedUsers).toBe(1);
  });

  it('refuses duplicate redemption IDs and simultaneous per-viewer redemptions', async () => {
    const { service } = setup(mode);
    const results = await Promise.all([
      service.reinforce(redemption, 'reward'),
      service.reinforce({ ...redemption, redemptionId: 'another' }, 'reward'),
      service.reinforce({ ...redemption, userId: 'other' }, 'reward'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(service.weight('other', 0)).toBe(1);
    expect(service.effects()).toHaveLength(1);
  });

  it('does not share budgets across newly constructed match instances', async () => {
    const { gate, service } = setup(mode);
    await service.fire('host', 'oil');
    const next = new SpecialService(gate, {
      hostId: 'host',
      raiderId: 'raider',
      matchId: 'next',
      now: () => 0,
    });
    expect(await next.fire('host', 'oil')).toBeDefined();
  });
});

describe('special gate failures', () => {
  it('keeps state unchanged when the gate blocks', async () => {
    const config = defaultPolicy();
    config.defaults.mode = 'enforce';
    config.actions['special.fire'].otherwise = { verdict: 'BLOCK', reason: 'TEST_BLOCK' };
    const gate = new LocalPolicyGate(config, { logger: () => undefined });
    const service = new SpecialService(gate, {
      hostId: 'host',
      raiderId: 'raider',
      matchId: 'match',
      now: () => 0,
    });
    expect(await service.fire('host', 'oil')).toBeUndefined();
    expect(service.effects()).toEqual([]);
    expect(service.budgets.oil).toBe(1);
  });

  it('contains authority errors and releases the reservation without consuming a budget', async () => {
    const { gate, service } = setup();
    vi.spyOn(gate, 'authorize').mockRejectedValueOnce(new Error('offline'));
    expect(await service.fire('host', 'oil')).toBeUndefined();
    expect(service.budgets.oil).toBe(1);
    expect(await service.fire('host', 'oil')).toBeDefined();
  });

  it('honors the special failure default even while shadow mode is enabled', async () => {
    const gate = new LocalPolicyGate(defaultPolicy(), {
      evaluate: () => {
        throw new Error('offline');
      },
      logger: () => undefined,
    });
    const service = new SpecialService(gate, {
      hostId: 'host',
      raiderId: 'raider',
      matchId: 'match',
      now: () => 0,
    });
    expect(await service.fire('host', 'oil')).toBeUndefined();
    expect(await service.reinforce(redemption, 'reward')).toBeUndefined();
    expect(service.effects()).toEqual([]);
    expect(service.budgets).toEqual({ ram: 1, oil: 1, reinforcedUsers: 0 });
  });

  it('snapshots redemption input before awaiting the gate', async () => {
    const { service } = setup();
    const event = { ...redemption };
    const pending = service.reinforce(event, 'reward');
    event.userId = 'imposter';
    await pending;
    expect(service.weight('viewer', 0)).toBe(2);
    expect(service.weight('imposter', 0)).toBe(1);
  });
});
