import { describe, expect, it } from 'vitest';
import { defaultPolicy, LocalPolicyGate } from '@raidrumble/policy';
import { Ledger } from '../src/ledger.js';
import { LedgerService } from '../src/service.js';
import { record, track } from './fixture.js';

describe('governed ledger settlement', () => {
  it('authorises before writing and binds the returned decision to the stored aggregate', async () => {
    const ledger = track(new Ledger());
    const gate = new LocalPolicyGate(defaultPolicy(), { logger: () => undefined });
    const result = await new LedgerService(gate, ledger).settle(record());
    expect(result.executed).toBe(true);
    const stored = ledger.match('match1');
    expect(stored?.settleDecisionId).toBe(result.decision.decisionId);
    expect(stored?.unsigned).toBe(true);
    expect(gate.getRequest(result.decision.decisionId)).toMatchObject({
      action: 'ledger.settle',
      matchId: 'match1',
      payload: { startDecisionId: 'start1' },
    });
  });

  it('honours a configured BLOCK in enforce mode without writing', async () => {
    const ledger = track(new Ledger());
    const policy = defaultPolicy();
    policy.actions['ledger.settle'].mode = 'enforce';
    policy.actions['ledger.settle'].otherwise = { verdict: 'BLOCK', reason: 'TEST_BLOCK' };
    const gate = new LocalPolicyGate(policy, { logger: () => undefined });
    const result = await new LedgerService(gate, ledger).settle(record());
    expect(result.executed).toBe(false);
    expect(ledger.match('match1')).toBeUndefined();
  });

  it('writes an explicitly unsigned local result when authority evaluation fails', async () => {
    const ledger = track(new Ledger());
    const gate = new LocalPolicyGate(defaultPolicy(), {
      logger: () => undefined,
      evaluate: () => {
        throw new Error('authority unavailable');
      },
    });
    const result = await new LedgerService(gate, ledger).settle(record());
    expect(result.executed).toBe(true);
    expect(result.value?.match.unsigned).toBe(true);
  });

  it('uses only the actual settlement decision dossier, never extra caller properties', async () => {
    const ledger = track(new Ledger());
    const gate = new LocalPolicyGate(defaultPolicy(), { logger: () => undefined });
    await new LedgerService(gate, ledger).settle(record({ settleDossierId: 'unrelatedDossier' }));
    expect(ledger.match('match1')?.settleDossierId).toBeUndefined();
  });

  it('is idempotent under concurrent settlement requests', async () => {
    const ledger = track(new Ledger());
    const gate = new LocalPolicyGate(defaultPolicy(), { logger: () => undefined });
    const service = new LedgerService(gate, ledger);
    const results = await Promise.all([service.settle(record()), service.settle(record())]);
    expect(results.every((result) => result.executed)).toBe(true);
    expect(results.filter((result) => result.value?.inserted)).toHaveLength(1);
    expect(ledger.pair('host', 'raider')?.matches).toBe(1);
  });
});
