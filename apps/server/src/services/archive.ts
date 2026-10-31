import {
  LocalPolicyGate,
  PolicyExecutor,
  type ConfigurablePolicyGate,
  type Decision,
} from '@raidrumble/policy';
import type { CompletedMatch, RoomOptions } from './room.js';

export type MatchCompletion = Omit<CompletedMatch, 'settleDecision'>;
export interface ArchiveKey {
  matchId: string;
  hostId: string;
  raiderId: string;
  startDecisionId: string;
}

/** Serialises governed persistence so a headless clock cannot outrun its settlement write. */
export class MatchArchive {
  private work: Promise<void> = Promise.resolve();
  private readonly errors: string[] = [];
  private fallback?: { gate: LocalPolicyGate; executor: PolicyExecutor };

  constructor(
    private readonly gate: ConfigurablePolicyGate,
    private readonly executor: PolicyExecutor,
    private readonly options: Pick<RoomOptions, 'onSettle' | 'onRetention' | 'now' | 'quiet'>,
  ) {}

  get failures(): readonly string[] {
    return [...this.errors];
  }

  settle(record: MatchCompletion): Promise<boolean> {
    return this.enqueue(async () => {
      const decision = await this.authorize(
        { ...record, startDecisionId: record.startDecision.decisionId },
        'result',
      );
      const execution = await this.execute(decision, async (effectiveDecision) => {
        const result = await this.options.onSettle?.({
          ...record,
          settleDecision: effectiveDecision,
        });
        if (result === false) throw new Error('Settlement storage refused the write.');
      });
      if (!execution.executed)
        throw new Error(`Settlement ${record.matchId}: ${execution.reason ?? 'failed'}`);
      return true;
    }).catch(() => false);
  }

  retention(key: ArchiveKey, count: number, settled: Promise<boolean>): void {
    void this.enqueue(async () => {
      if (!(await settled)) return;
      const decision = await this.authorize(key, 'retention', count);
      const execution = await this.execute(decision, async (effectiveDecision) => {
        const result = await this.options.onRetention?.(key.matchId, count, effectiveDecision);
        if (result === false) throw new Error('Retention storage could not find its match.');
      });
      if (!execution.executed)
        throw new Error(`Retention ${key.matchId}: ${execution.reason ?? 'failed'}`);
    });
  }

  async flush(): Promise<void> {
    let pending;
    do {
      pending = this.work;
      await pending;
    } while (pending !== this.work);
    if (this.errors.length)
      throw new Error(`Could not persist match data: ${this.errors.join('; ')}`);
  }

  private authorize(key: ArchiveKey, phase: string, count?: number): Promise<Decision> {
    return this.gate.authorize({
      action: 'ledger.settle',
      actor: { kind: 'system' },
      channel: { hostId: key.hostId, raiderId: key.raiderId },
      matchId: key.matchId,
      payload: {
        startDecisionId: key.startDecisionId,
        phase,
        ...(count === undefined ? {} : { retention: count }),
      },
    });
  }

  private async execute(decision: Decision, effect: (effective: Decision) => Promise<void>) {
    let dispatched = false;
    const result = await this.executor.execute(decision, () => {
      dispatched = true;
      return effect(decision);
    });
    if (
      dispatched ||
      result.executed ||
      result.reason !== 'GRANT_UNAVAILABLE' ||
      decision.source !== 'decionis'
    )
      return result;
    const request = this.gate.getRequest(decision.decisionId);
    const config = this.gate.getConfig();
    if (
      request?.action !== 'ledger.settle' ||
      config.actions['ledger.settle'].onFailure !== 'LOCAL'
    )
      return result;
    if (!this.fallback) {
      const localConfig = structuredClone(config);
      localConfig.actions['ledger.settle'].mode = 'enforce';
      const gate = new LocalPolicyGate(localConfig, {
        now: this.options.now,
        ...(this.options.quiet ? { logger: () => undefined } : {}),
        evaluate: (req, rules) =>
          req.action === 'ledger.settle' && rules.actions['ledger.settle'].onFailure === 'LOCAL'
            ? {
                verdict: 'ALLOW',
                reasonCodes: ['HOSTED_GRANT_UNAVAILABLE', 'UNSIGNED_LEDGER_FALLBACK'],
              }
            : { verdict: 'BLOCK', reasonCodes: ['LEDGER_FALLBACK_NOT_PERMITTED'] },
      });
      this.fallback = { gate, executor: new PolicyExecutor(gate) };
    }
    const local = await this.fallback.gate.authorize({
      ...request,
      payload: {
        ...request.payload,
        failedDecisionId: decision.decisionId,
        ...(decision.dossierId ? { failedDossierId: decision.dossierId } : {}),
      },
    });
    return this.fallback.executor.execute(local, () => effect(local));
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const task = this.work.then(action);
    this.work = task.then(
      () => undefined,
      (error: unknown) => {
        this.errors.push(error instanceof Error ? error.message : 'Persistence failed.');
      },
    );
    return task;
  }
}
