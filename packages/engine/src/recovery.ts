import type { RoundResult, RoundView } from './model.js';
import type { RunningRound } from './round.js';

/** A failed plug-in loses its scoring, while its slot and the match clock continue. */
export class RecoveryRound implements RunningRound {
  constructor(
    readonly id: string,
    readonly durationMs: number,
    readonly elapsedMs = 0,
  ) {}

  onInput(): RunningRound {
    return this;
  }

  tick(dtMs: number): RunningRound {
    return new RecoveryRound(
      this.id,
      this.durationMs,
      Math.min(this.durationMs, this.elapsedMs + dtMs),
    );
  }

  view(): RoundView {
    return {
      id: this.id,
      title: 'Round recovering',
      phase: this.elapsedMs >= this.durationMs ? 'finished' : 'active',
      elapsedMs: this.elapsedMs,
      durationMs: this.durationMs,
      remainingMs: this.durationMs - this.elapsedMs,
      keyword: 'CHEER',
      instruction: 'The arena will continue shortly.',
      progress: this.elapsedMs / this.durationMs,
      scores: { home: 0, raiders: 0 },
    };
  }

  result(): RoundResult {
    return {
      roundId: this.id,
      winner: 'none',
      mvps: { home: [], raiders: [] },
      stats: { degraded: 1 },
    };
  }
}
