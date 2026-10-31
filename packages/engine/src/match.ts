import { InputLimiter, type LimiterState } from './limiter.js';
import type { MatchContext, MatchView, PlayerInput, RoundResult } from './model.js';
import { RecoveryRound } from './recovery.js';
import type { RoundDefinition, RunningRound } from './round.js';

export interface MatchState {
  readonly context: MatchContext;
  readonly startedAtMs: number;
  readonly elapsedMs: number;
  readonly roundElapsedMs: number;
  readonly roundIndex: number;
  readonly status: 'playing' | 'endcard' | 'finished';
  readonly active: RunningRound;
  readonly results: readonly RoundResult[];
  readonly limits: LimiterState;
  readonly degraded: boolean;
}

export interface MatchInputResult {
  readonly state: MatchState;
  readonly counted: boolean;
}

/** Pure orchestration. Persist only view() and results, never the ephemeral live state. */
export class MatchTimeline {
  readonly durationMs: number;
  readonly gameplayMs: number;

  constructor(
    readonly rounds: readonly RoundDefinition[],
    readonly endCardMs = 10_000,
  ) {
    if (!rounds.length || new Set(rounds.map((round) => round.id)).size !== rounds.length) {
      throw new Error('A match needs rounds with unique ids.');
    }
    if (!Number.isFinite(endCardMs) || endCardMs < 0) throw new Error('Invalid end card duration.');
    this.gameplayMs = rounds.reduce((sum, round) => sum + round.durationMs, 0);
    this.durationMs = this.gameplayMs + endCardMs;
  }

  start(ctx: MatchContext): MatchState {
    const first = this.rounds[0];
    if (!first || !Number.isFinite(ctx.nowMs)) throw new Error('Invalid initial match context.');
    const round = this.startRound(first, ctx);
    return {
      context: ctx,
      startedAtMs: ctx.nowMs,
      elapsedMs: 0,
      roundElapsedMs: 0,
      roundIndex: 0,
      status: 'playing',
      active: round.active,
      results: [],
      limits: new Map(),
      degraded: round.degraded,
    };
  }

  tick(state: MatchState, dtMs: number, ctx: MatchContext = state.context): MatchState {
    if (state.status === 'finished' || !Number.isFinite(dtMs) || dtMs <= 0) return state;
    let next = state;
    let remaining = Math.min(dtMs, this.durationMs - state.elapsedMs);
    while (remaining > 0) {
      if (next.status !== 'playing') {
        const elapsedMs = Math.min(this.durationMs, next.elapsedMs + remaining);
        return {
          ...next,
          elapsedMs,
          context: this.contextAt(next, ctx, elapsedMs),
          status: elapsedMs >= this.durationMs ? 'finished' : 'endcard',
        };
      }
      const step = Math.min(remaining, next.active.durationMs - next.roundElapsedMs);
      next = this.tickRound(next, step, ctx);
      remaining -= step;
      if (next.roundElapsedMs >= next.active.durationMs) next = this.advance(next);
    }
    return next;
  }

  /** Tick to event time, then commit limits only after the plug-in counts the input. */
  onInput(
    state: MatchState,
    input: PlayerInput,
    ctx: MatchContext = state.context,
  ): MatchInputResult {
    const currentTime = state.startedAtMs + state.elapsedMs;
    if (!Number.isFinite(input.atMs) || input.atMs < currentTime || state.status === 'finished') {
      return { state, counted: false };
    }
    const advanced = this.tick(state, input.atMs - currentTime, ctx);
    const next =
      ctx === advanced.context
        ? advanced
        : { ...advanced, context: this.contextAt(advanced, ctx, advanced.elapsedMs) };
    if (next.status !== 'playing') return { state: next, counted: false };
    const limit = new InputLimiter(2_000, state.startedAtMs).consume(
      next.limits,
      input.userId,
      input.atMs,
    );
    if (!limit.allowed) return { state: next, counted: false };
    try {
      const active = next.active.onInput(input, next.context);
      if (active === next.active) return { state: next, counted: false };
      return { state: { ...next, active, limits: limit.state }, counted: true };
    } catch {
      return {
        state: { ...next, active: this.recover(next), degraded: true },
        counted: false,
      };
    }
  }

  view(state: MatchState): MatchView {
    let round;
    let degraded = state.degraded;
    try {
      round = state.active.view();
    } catch {
      round = this.recover(state).view();
      degraded = true;
    }
    return {
      matchId: state.context.matchId,
      status: state.status,
      elapsedMs: state.elapsedMs,
      remainingMs: Math.max(0, this.durationMs - state.elapsedMs),
      roundIndex: state.roundIndex,
      roundCount: this.rounds.length,
      round,
      results: state.results,
      winner: state.results.at(-1)?.winner ?? 'none',
      teams: state.context.teams,
      degraded,
    };
  }

  private tickRound(state: MatchState, step: number, ctx: MatchContext): MatchState {
    const elapsedMs = state.elapsedMs + step;
    const roundElapsedMs = state.roundElapsedMs + step;
    const context = this.contextAt(state, ctx, elapsedMs);
    let active;
    let degraded = state.degraded;
    try {
      active = state.active.tick(step, context);
    } catch {
      active = new RecoveryRound(state.active.id, state.active.durationMs, roundElapsedMs);
      degraded = true;
    }
    return { ...state, context, active, elapsedMs, roundElapsedMs, degraded };
  }

  private advance(state: MatchState): MatchState {
    let result;
    let degraded = state.degraded;
    try {
      result = state.active.result();
    } catch {
      result = this.recover(state).result();
      degraded = true;
    }
    const results = [...state.results, result];
    const definition = this.rounds[state.roundIndex + 1];
    if (!definition) {
      return { ...state, results, degraded, status: this.endCardMs > 0 ? 'endcard' : 'finished' };
    }
    const round = this.startRound(definition, state.context);
    return {
      ...state,
      active: round.active,
      roundIndex: state.roundIndex + 1,
      roundElapsedMs: 0,
      results,
      degraded: degraded || round.degraded,
    };
  }

  private startRound(
    definition: RoundDefinition,
    ctx: MatchContext,
  ): { active: RunningRound; degraded: boolean } {
    try {
      return { active: definition.start(ctx), degraded: false };
    } catch {
      return { active: new RecoveryRound(definition.id, definition.durationMs), degraded: true };
    }
  }

  private contextAt(state: MatchState, ctx: MatchContext, elapsedMs: number): MatchContext {
    return {
      ...ctx,
      matchId: state.context.matchId,
      seed: state.context.seed,
      rng: state.context.rng,
      nowMs: state.startedAtMs + elapsedMs,
    };
  }

  private recover(state: MatchState): RunningRound {
    return new RecoveryRound(state.active.id, state.active.durationMs, state.roundElapsedMs);
  }
}
