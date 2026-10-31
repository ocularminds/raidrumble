import {
  PolicyExecutor,
  type Decision,
  type ExecutionResult,
  type PolicyGate,
} from '@raidrumble/policy';
import type { Ledger } from './ledger.js';
import type { SettlementInput, SettlementResult } from './model.js';

export interface SettlementOutcome extends ExecutionResult<SettlementResult> {
  readonly decision: Decision;
}

/** Match outcomes always pass ledger.settle before the durable write occurs. */
export class LedgerService {
  constructor(
    private readonly gate: PolicyGate,
    private readonly ledger: Ledger,
  ) {}

  async settle(input: SettlementInput): Promise<SettlementOutcome> {
    const record: SettlementInput = {
      matchId: input.matchId,
      hostId: input.hostId,
      raiderId: input.raiderId,
      winner: input.winner,
      bossKilled: input.bossKilled,
      endedAtMs: input.endedAtMs,
      startDecisionId: input.startDecisionId,
      ...(input.startDossierId !== undefined ? { startDossierId: input.startDossierId } : {}),
      ...(input.hostName !== undefined ? { hostName: input.hostName } : {}),
      ...(input.raiderName !== undefined ? { raiderName: input.raiderName } : {}),
    };
    const decision = await this.gate.authorize({
      action: 'ledger.settle',
      actor: { kind: 'system' },
      channel: { hostId: record.hostId, raiderId: record.raiderId },
      matchId: record.matchId,
      payload: {
        startDecisionId: record.startDecisionId,
        winner: record.winner,
        bossKilled: record.bossKilled,
      },
    });
    const result = await new PolicyExecutor(this.gate).execute(decision, () =>
      this.ledger.settle({
        ...record,
        settleDecisionId: decision.decisionId,
        ...(decision.dossierId !== undefined ? { settleDossierId: decision.dossierId } : {}),
        unsigned: decision.source === 'local' || !record.startDossierId || !decision.dossierId,
      }),
    );
    return { ...result, decision };
  }
}
