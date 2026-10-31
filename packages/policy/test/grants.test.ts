import { describe, expect, it, vi } from 'vitest';
import { PolicyExecutor } from '../src/executor.js';
import { request, setup } from './helpers.js';

describe('approval grants and execution', () => {
  it('only lets the named host approve an outstanding escalation', async () => {
    const { gate } = setup();
    const held = await gate.authorize(request());
    await expect(gate.approve(held.decisionId, 'stranger')).rejects.toThrow('approver');
    const approved = await gate.approve(held.decisionId, 'host');
    expect(approved).toMatchObject({
      verdict: 'ALLOW',
      decisionId: held.decisionId,
      grant: { id: expect.any(String) },
    });
    await expect(gate.approve(held.decisionId, 'host')).rejects.toThrow('approved');
  });

  it('claims a grant once even when competing executions race', async () => {
    const { gate } = setup();
    const held = await gate.authorize(request());
    const approved = await gate.approve(held.decisionId, 'host');
    const effect = vi.fn().mockResolvedValue('started');
    const executor = new PolicyExecutor(gate);
    const results = await Promise.all([
      executor.execute(approved, effect),
      executor.execute(approved, effect),
    ]);
    expect(results.filter((result) => result.executed)).toHaveLength(1);
    expect(effect).toHaveBeenCalledTimes(1);
    expect(await gate.claimGrant(approved.grant!.id)).toBe(false);
  });

  it('refuses expired approvals and grants', async () => {
    const { gate, advance } = setup();
    const held = await gate.authorize(request());
    advance(10_000);
    await expect(gate.approve(held.decisionId, 'host')).rejects.toThrow('expired');
    const next = await gate.authorize(request());
    const approved = await gate.approve(next.decisionId, 'host');
    advance(10_000);
    expect(await gate.claimGrant(approved.grant!.id)).toBe(false);
  });

  it('refuses unknown IDs and attempts to approve ALLOW or BLOCK', async () => {
    const { gate } = setup();
    await expect(gate.approve('unknown', 'host')).rejects.toThrow('Unknown');
    expect(await gate.claimGrant('unknown')).toBe(false);
    const req = request();
    req.payload.raiderLogin = 'blocked';
    const blocked = await gate.authorize(req);
    await expect(gate.approve(blocked.decisionId, 'host')).rejects.toThrow('escalation');
  });

  it('cannot substitute a grant onto a different action or forge a decision', async () => {
    const { gate } = setup();
    const held = await gate.authorize(request());
    const approved = await gate.approve(held.decisionId, 'host');
    const req = request('special.fire');
    req.payload = { special: 'oil', budgetRemaining: 0 };
    const blocked = await gate.authorize(req);
    const effect = vi.fn();
    const executor = new PolicyExecutor(gate);
    expect(
      (await executor.execute({ ...blocked, verdict: 'ALLOW', grant: approved.grant }, effect))
        .executed,
    ).toBe(false);
    expect((await executor.execute({ ...approved, decisionId: 'forged' }, effect)).executed).toBe(
      false,
    );
    expect(effect).not.toHaveBeenCalled();
    expect((await executor.execute(approved, effect)).executed).toBe(true);
  });

  it('rejects decisions from another gate and leaves the real grant usable', async () => {
    const first = setup();
    const second = setup();
    const decision = await first.gate.authorize(request('ledger.settle'));
    expect((await new PolicyExecutor(second.gate).execute(decision, vi.fn())).executed).toBe(false);
  });

  it('allows shadow effects while recording the original verdict', async () => {
    const { gate } = setup('shadow');
    const req = request();
    req.payload.raiderLogin = 'blocked';
    const decision = await gate.authorize(req);
    const result = await new PolicyExecutor(gate).execute(decision, () => 42);
    expect(decision.verdict).toBe('BLOCK');
    expect(result).toMatchObject({ executed: true, value: 42 });
  });

  it('keeps enforced BLOCK and unapproved ESCALATE from running', async () => {
    const { gate } = setup();
    const held = await gate.authorize(request());
    const effect = vi.fn();
    expect((await new PolicyExecutor(gate).execute(held, effect)).executed).toBe(false);
    expect(effect).not.toHaveBeenCalled();
  });

  it('keeps request binding immutable and consumes decisions after effect errors', async () => {
    const { gate } = setup();
    const req = request('ledger.settle');
    const decision = await gate.authorize(req);
    req.action = 'rumble.start';
    expect(gate.getRequest(decision.decisionId)?.action).toBe('ledger.settle');
    const effect = vi.fn().mockRejectedValue(new Error('offline'));
    const executor = new PolicyExecutor(gate);
    expect(await executor.execute(decision, effect)).toMatchObject({
      executed: false,
      reason: 'EFFECT_FAILED',
    });
    expect((await executor.execute(decision, effect)).executed).toBe(false);
    expect(effect).toHaveBeenCalledTimes(1);
  });
});
