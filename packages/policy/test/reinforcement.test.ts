import { describe, expect, it } from 'vitest';
import type { PolicyMode } from '../src/models.js';
import { request, setup } from './helpers.js';

describe.each<PolicyMode>(['shadow', 'enforce'])('Reinforcements policy in %s mode', (mode) => {
  function redemptionRequest() {
    const req = request('special.fire');
    req.actor = { kind: 'viewer', twitchUserId: 'viewer' };
    req.payload = {
      special: 'reinforcements',
      budgetRemaining: 1,
      rewardId: 'reward',
      expectedRewardId: 'reward',
      redemptionStatus: 'fulfilled',
      redemptionId: 'redemption',
      redeemerId: 'viewer',
    };
    return req;
  }

  it('allows the identified redeemer for the configured completed reward', async () => {
    const { gate } = setup(mode);
    expect(await gate.authorize(redemptionRequest())).toMatchObject({ verdict: 'ALLOW', mode });
  });

  it.each([
    { rewardId: 'other' },
    { expectedRewardId: '' },
    { redemptionStatus: 'unfulfilled' },
    { redemptionStatus: 'canceled' },
    { redemptionId: '' },
  ])('blocks unverifiable redemption facts: %j', async (payload) => {
    const { gate } = setup(mode);
    const req = redemptionRequest();
    Object.assign(req.payload, payload);
    expect(await gate.authorize(req)).toMatchObject({
      verdict: 'BLOCK',
      reasonCodes: expect.arrayContaining(['REINFORCEMENT_REDEMPTION_INVALID']),
    });
  });

  it('refuses another actor or exhausted per-user budget', async () => {
    const { gate } = setup(mode);
    const req = redemptionRequest();
    req.actor.twitchUserId = 'imposter';
    expect((await gate.authorize(req)).reasonCodes).toContain('SPECIAL_ROLE_MISMATCH');
    req.actor.twitchUserId = 'viewer';
    req.payload.budgetRemaining = 0;
    expect((await gate.authorize(req)).reasonCodes).toContain('SPECIAL_BUDGET_EXHAUSTED');
  });
});
