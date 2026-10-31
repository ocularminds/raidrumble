import { describe, expect, it } from 'vitest';
import type { ActionRequest, PolicyMode } from '../src/models.js';
import { request, setup } from './helpers.js';

describe.each<PolicyMode>(['shadow', 'enforce'])('actions in %s mode', (mode) => {
  it('escalates a stranger and preserves the mode', async () => {
    const { gate } = setup(mode);
    expect(await gate.authorize(request())).toMatchObject({
      verdict: 'ESCALATE',
      mode,
      reasonCodes: ['UNKNOWN_RAIDER'],
      source: 'local',
    });
  });

  it.each([
    [{ raiderLogin: 'TRUSTED' }, 'RAIDER_ALLOWLISTED'],
    [{ hostFollowsRaider: true }, 'HOST_FOLLOWS_RAIDER'],
    [{ hasPriorMatch: true }, 'KNOWN_RIVAL'],
  ])('allows a trusted raid: %j', async (payload, reason) => {
    const { gate } = setup(mode);
    const req = request();
    Object.assign(req.payload, payload);
    expect(await gate.authorize(req)).toMatchObject({ verdict: 'ALLOW', reasonCodes: [reason] });
  });

  it.each([
    [{ raiderLogin: 'BLOCKED', hostFollowsRaider: true }, 'RAIDER_BLOCKLISTED'],
    [{ raiderAccountAgeDays: 6 }, 'RAIDER_ACCOUNT_TOO_NEW'],
    [{ raidViewers: 2 }, 'RAID_TOO_SMALL'],
    [{ raidsLastHour: 3 }, 'RAID_FLOOD'],
  ])('blocks an unsafe raid before considering allow rules: %j', async (payload, reason) => {
    const { gate } = setup(mode);
    const req = request();
    Object.assign(req.payload, { raiderLogin: 'trusted' }, payload);
    expect(await gate.authorize(req)).toMatchObject({
      verdict: 'BLOCK',
      mode,
      reasonCodes: [reason],
    });
  });

  it('allows a valid Shared Chat collab and holds an unknown participant', async () => {
    const { gate } = setup(mode);
    const req: ActionRequest = {
      ...request('rumble.start.collab'),
      actor: { kind: 'host', twitchUserId: 'host' },
      payload: {
        participants: [{ id: 'raider', login: 'trusted' }],
        sessionParticipantIds: ['host', 'raider'],
      },
    };
    expect((await gate.authorize(req)).verdict).toBe('ALLOW');
    req.payload.participants = [{ id: 'raider', login: 'visitor' }];
    expect((await gate.authorize(req)).verdict).toBe('ESCALATE');
    req.payload.sessionParticipantIds = ['host'];
    expect((await gate.authorize(req)).verdict).toBe('BLOCK');
  });

  it('gates content terms and moderation flags', async () => {
    const { gate } = setup(mode);
    const req = request('content.render');
    req.payload = { text: 'A friendly gate' };
    expect((await gate.authorize(req)).verdict).toBe('ALLOW');
    req.payload.text = 'A FORBIDDEN boss';
    expect((await gate.authorize(req)).reasonCodes).toContain('BLOCKED_TERM');
    req.payload = { text: 'A friendly gate', moderationFlagged: true };
    expect((await gate.authorize(req)).reasonCodes).toContain('MODERATION_FLAGGED');
  });

  it('requires generated chat to match an allowed content decision on this host', async () => {
    const { gate } = setup(mode);
    const content = request('content.render');
    content.payload = { text: 'Welcome to the arena' };
    const decision = await gate.authorize(content);
    const req = request('chat.send');
    req.payload = { text: 'Welcome to the arena', templated: true };
    expect((await gate.authorize(req)).verdict).toBe('ALLOW');
    req.payload.lastSentAt = 999;
    expect((await gate.authorize(req)).reasonCodes).toContain('CHAT_RATE_LIMIT');
    delete req.payload.lastSentAt;
    req.payload.templated = false;
    expect((await gate.authorize(req)).verdict).toBe('BLOCK');
    req.payload.contentDecisionId = decision.decisionId;
    expect((await gate.authorize(req)).verdict).toBe('ALLOW');
    req.payload.text = 'Different text';
    expect((await gate.authorize(req)).verdict).toBe('BLOCK');
    req.payload.text = 'Welcome to the arena';
    req.channel.hostId = 'other';
    expect((await gate.authorize(req)).verdict).toBe('BLOCK');
  });

  it.each([
    ['ram', 'warlord', 'raider'],
    ['oil', 'host', 'host'],
  ] as const)(
    'matches %s to its exact role, identity and remaining budget',
    async (special, kind, twitchUserId) => {
      const { gate } = setup(mode);
      const req = request('special.fire');
      req.actor = { kind, twitchUserId };
      req.payload = { special, budgetRemaining: 1 };
      expect((await gate.authorize(req)).verdict).toBe('ALLOW');
      req.actor.twitchUserId = 'imposter';
      expect((await gate.authorize(req)).reasonCodes).toContain('SPECIAL_ROLE_MISMATCH');
      req.actor.twitchUserId = twitchUserId;
      req.payload.budgetRemaining = 0;
      expect((await gate.authorize(req)).reasonCodes).toContain('SPECIAL_BUDGET_EXHAUSTED');
    },
  );

  it('holds reward setup for the channel host', async () => {
    const { gate } = setup(mode);
    const req = request('rewards.configure');
    req.actor = { kind: 'host', twitchUserId: 'host' };
    req.payload = {};
    expect(await gate.authorize(req)).toMatchObject({
      verdict: 'ESCALATE',
      reasonCodes: ['REWARD_SETUP_APPROVAL'],
    });
  });

  it('enforces a per-raider shoutout cooldown', async () => {
    const { gate } = setup(mode);
    const req = request('shoutout.send');
    req.payload = {};
    expect((await gate.authorize(req)).verdict).toBe('ALLOW');
    req.payload.lastSentAt = 999;
    expect((await gate.authorize(req)).verdict).toBe('BLOCK');
    req.payload.lastSentAt = 1_000 - 3_600_000;
    expect((await gate.authorize(req)).verdict).toBe('ALLOW');
  });

  it('permits local settlement and records minimal structured receipts', async () => {
    const { gate, logger } = setup(mode);
    const req = request('ledger.settle');
    req.payload = { startDecisionId: 'start' };
    const decision = await gate.authorize(req);
    expect(decision.verdict).toBe('ALLOW');
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionId: decision.decisionId,
        action: 'ledger.settle',
        mode,
        verdict: 'ALLOW',
        reasonCodes: ['LEDGER_SETTLEMENT'],
      }),
    );
    expect(gate.listRecords()[0]).not.toHaveProperty('payload');
  });
});
