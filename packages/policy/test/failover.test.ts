import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPolicy } from '../src/defaults.js';
import { LocalPolicyGate } from '../src/local.js';
import { PolicyExecutor } from '../src/executor.js';
import type { ActionName, PolicyMode } from '../src/models.js';
import { request, setup } from './helpers.js';

afterEach(() => vi.useRealTimers());

describe.each<PolicyMode>(['shadow', 'enforce'])('execution failures in %s mode', (mode) => {
  function failingGate() {
    const config = defaultPolicy();
    config.defaults.mode = mode;
    return new LocalPolicyGate(config, {
      evaluate: () => {
        throw new Error('offline');
      },
      logger: () => undefined,
    });
  }

  it.each<ActionName>([
    'content.render',
    'chat.send',
    'special.fire',
    'rewards.configure',
    'shoutout.send',
    'events.subscribe',
  ])('%s executes no effect when policy evaluation fails', async (action) => {
    const gate = failingGate();
    const decision = await gate.authorize(request(action));
    const effect = vi.fn();
    expect((await new PolicyExecutor(gate).execute(decision, effect)).executed).toBe(false);
    expect(effect).not.toHaveBeenCalled();
  });

  it.each<ActionName>(['rumble.start', 'rumble.start.collab'])(
    '%s stays held on failure until the host approves',
    async (action) => {
      const gate = failingGate();
      const decision = await gate.authorize(request(action));
      const executor = new PolicyExecutor(gate);
      const effect = vi.fn();
      expect((await executor.execute(decision, effect)).executed).toBe(false);
      expect(effect).not.toHaveBeenCalled();
      const approved = await gate.approve(decision.decisionId, 'host');
      expect((await executor.execute(approved, effect)).executed).toBe(true);
      expect(effect).toHaveBeenCalledOnce();
    },
  );

  it('permits the explicitly unsigned ledger fallback', async () => {
    const gate = failingGate();
    const decision = await gate.authorize(request('ledger.settle'));
    expect(decision.reasonCodes).toContain('UNSIGNED_LEDGER_FALLBACK');
    expect((await new PolicyExecutor(gate).execute(decision, () => 'local')).executed).toBe(true);
  });
});

describe('shadow mode failure boundary', () => {
  it('keeps a timed-out start held in shadow mode', async () => {
    vi.useFakeTimers();
    const gate = new LocalPolicyGate(defaultPolicy(), {
      evaluate: () => new Promise(() => undefined),
      logger: () => undefined,
    });
    const pending = gate.authorize(request());
    await vi.advanceTimersByTimeAsync(1500);
    const decision = await pending;
    const effect = vi.fn();
    expect((await new PolicyExecutor(gate).execute(decision, effect)).executed).toBe(false);
    expect(effect).not.toHaveBeenCalled();
  });

  it('never calls Helix for a failed chat decision in shadow mode', async () => {
    const gate = new LocalPolicyGate(defaultPolicy(), {
      evaluate: () => {
        throw new Error('offline');
      },
      logger: () => undefined,
    });
    const req = request('chat.send');
    req.actor = { kind: 'system', twitchUserId: 'bot' };
    req.payload = { text: 'Welcome', templated: true };
    const decision = await gate.authorize(req);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const result = await new PolicyExecutor(gate).executeHelix(
      decision,
      {
        method: 'POST',
        path: '/chat/messages',
        body: { broadcaster_id: 'host', sender_id: 'bot', message: 'Welcome' },
      },
      { clientId: 'client', accessToken: 'test', fetch: transport },
    );
    expect(result.executed).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it('still executes an ordinary would-block shadow decision', async () => {
    const { gate } = setup('shadow');
    const req = request();
    req.payload.raiderLogin = 'blocked';
    const decision = await gate.authorize(req);
    expect(decision.verdict).toBe('BLOCK');
    expect((await new PolicyExecutor(gate).execute(decision, () => 'shadow')).executed).toBe(true);
  });
});
