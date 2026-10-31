import { type Decision, type LocalPolicyGate, type PolicyExecutor } from '@raidrumble/policy';
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

  constructor(
    private readonly gate: LocalPolicyGate,
    private readonly executor: PolicyExecutor,
    private readonly options: Pick<RoomOptions, 'onSettle' | 'onRetention'>,
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
      const execution = await this.executor.execute(decision, async () => {
        const result = await this.options.onSettle?.({ ...record, settleDecision: decision });
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
      const execution = await this.executor.execute(decision, async () => {
        const result = await this.options.onRetention?.(key.matchId, count, decision);
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
