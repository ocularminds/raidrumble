import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPolicy } from '../src/defaults.js';
import { LocalPolicyGate } from '../src/local.js';
import type { ActionName, Verdict } from '../src/models.js';
import { request, setup } from './helpers.js';

afterEach(() => vi.useRealTimers());

describe('policy latency and failure defaults', () => {
  const failures: [ActionName, Verdict, string][] = [
    ['rumble.start', 'ESCALATE', 'POLICY_TIMEOUT'],
    ['rumble.start.collab', 'ESCALATE', 'POLICY_TIMEOUT'],
    ['content.render', 'BLOCK', 'CONTENT_TEMPLATE_FALLBACK'],
    ['chat.send', 'BLOCK', 'MESSAGE_SKIPPED'],
    ['special.fire', 'BLOCK', 'ACTION_BLOCKED'],
    ['rewards.configure', 'BLOCK', 'ACTION_BLOCKED'],
    ['shoutout.send', 'BLOCK', 'MESSAGE_SKIPPED'],
    ['ledger.settle', 'ALLOW', 'UNSIGNED_LEDGER_FALLBACK'],
    ['events.subscribe', 'BLOCK', 'ACTION_BLOCKED'],
  ];

  it.each(failures)('%s applies its failure rule after 120ms', async (action, verdict, reason) => {
    vi.useFakeTimers();
    const gate = new LocalPolicyGate(defaultPolicy(), {
      evaluate: () => new Promise(() => undefined),
      logger: () => undefined,
    });
    const pending = gate.authorize(request(action));
    await vi.advanceTimersByTimeAsync(120);
    expect(await pending).toMatchObject({ verdict, reasonCodes: expect.arrayContaining([reason]) });
  });

  it('allows host approval of a start held because evaluation failed', async () => {
    const config = defaultPolicy();
    config.defaults.mode = 'enforce';
    const gate = new LocalPolicyGate(config, {
      evaluate: () => {
        throw new Error('offline');
      },
      logger: () => undefined,
    });
    const decision = await gate.authorize(request());
    expect(decision).toMatchObject({
      verdict: 'ESCALATE',
      reasonCodes: expect.arrayContaining(['POLICY_ERROR']),
    });
    expect((await gate.approve(decision.decisionId, 'host')).grant).toBeDefined();
  });

  it('does not let malformed raid facts fail open', async () => {
    const { gate } = setup();
    const req = request();
    req.payload = { raiderLogin: 'trusted', raidViewers: -1 };
    expect((await gate.authorize(req)).verdict).toBe('ESCALATE');
  });

  it('contains logging errors and changes mode per action', async () => {
    const gate = new LocalPolicyGate(defaultPolicy(), {
      logger: () => {
        throw new Error('log unavailable');
      },
    });
    gate.setMode('rumble.start', 'enforce');
    expect((await gate.authorize(request())).mode).toBe('enforce');
    expect((await gate.authorize(request('ledger.settle'))).mode).toBe('shadow');
  });
});
