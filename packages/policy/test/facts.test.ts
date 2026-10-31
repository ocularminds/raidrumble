import { describe, expect, it } from 'vitest';
import { request, setup } from './helpers.js';

function unavailable() {
  const req = request();
  req.payload = {
    ...req.payload,
    raiderLogin: 'trusted',
    raiderAccountAgeDays: null,
    hostFollowsRaider: null,
    factsUnavailable: true,
  };
  return req;
}

describe('explicitly unavailable Twitch raid facts', () => {
  it('holds a trusted raider without inventing a new-account violation', async () => {
    const { gate } = setup();
    expect(await gate.authorize(unavailable())).toMatchObject({
      verdict: 'ESCALATE',
      reasonCodes: ['RAID_FACTS_UNAVAILABLE'],
    });
  });

  it.each([
    [{ raiderLogin: 'blocked' }, 'RAIDER_BLOCKLISTED'],
    [{ raidViewers: 2 }, 'RAID_TOO_SMALL'],
    [{ raidsLastHour: 3 }, 'RAID_FLOOD'],
    [{ raiderAccountAgeDays: 2 }, 'RAIDER_ACCOUNT_TOO_NEW'],
  ])('preserves an independently known violation: %j', async (payload, reason) => {
    const { gate } = setup();
    const req = unavailable();
    Object.assign(req.payload, payload);
    expect(await gate.authorize(req)).toMatchObject({ verdict: 'BLOCK', reasonCodes: [reason] });
  });

  it('does not let trust or a prior ledger entry bypass the missing fact', async () => {
    const { gate } = setup();
    const req = unavailable();
    req.payload.hasPriorMatch = true;
    expect((await gate.authorize(req)).reasonCodes).toEqual(['RAID_FACTS_UNAVAILABLE']);
    req.payload.raiderAccountAgeDays = 90;
    req.payload.hostFollowsRaider = true;
    req.payload.factsUnavailable = false;
    expect((await gate.authorize(req)).verdict).toBe('ALLOW');
  });

  it('keeps ordinary null, missing and invalid payloads on the error fallback', async () => {
    const { gate } = setup();
    const req = unavailable();
    delete req.payload.factsUnavailable;
    expect((await gate.authorize(req)).reasonCodes).toEqual(['POLICY_ERROR']);
    req.payload.factsUnavailable = true;
    delete req.payload.raiderAccountAgeDays;
    expect((await gate.authorize(req)).reasonCodes).toEqual(['POLICY_ERROR']);
    req.payload.raiderAccountAgeDays = -1;
    expect((await gate.authorize(req)).reasonCodes).toEqual(['POLICY_ERROR']);
  });
});
