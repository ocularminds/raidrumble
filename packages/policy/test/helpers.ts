import { vi } from 'vitest';
import type { ActionName, ActionRequest, PolicyMode } from '../src/models.js';
import { defaultPolicy } from '../src/defaults.js';
import { LocalPolicyGate } from '../src/local.js';

export function request(action: ActionName = 'rumble.start'): ActionRequest {
  return {
    action,
    actor: { kind: 'system' },
    channel: { hostId: 'host', raiderId: 'raider' },
    matchId: 'match',
    payload: {
      raiderLogin: 'visitor',
      raiderAccountAgeDays: 90,
      raidViewers: 30,
      raidsLastHour: 1,
      hostFollowsRaider: false,
      hasPriorMatch: false,
    },
  };
}

export function setup(mode: PolicyMode = 'enforce') {
  let time = 1_000;
  let counter = 0;
  const config = defaultPolicy();
  config.defaults.mode = mode;
  config.lists.allow = ['trusted'];
  config.lists.block = ['blocked'];
  config.lists.blockedTerms = ['forbidden'];
  const logger = vi.fn();
  const gate = new LocalPolicyGate(config, {
    now: () => time,
    id: () => `policy-${++counter}`,
    logger,
  });
  return {
    gate,
    logger,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
