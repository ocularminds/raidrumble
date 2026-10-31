import type { MatchContext, PlayerInput, RoundModule, RoundResult, RoundView } from './model.js';

/** A type-erased live instance keeps each plug-in's state and module paired safely. */
export interface RunningRound {
  readonly id: string;
  readonly durationMs: number;
  onInput(input: PlayerInput, ctx: MatchContext): RunningRound;
  tick(dtMs: number, ctx: MatchContext): RunningRound;
  view(): RoundView;
  result(): RoundResult;
}

export interface RoundDefinition {
  readonly id: string;
  readonly durationMs: number;
  start(ctx: MatchContext): RunningRound;
}

class RoundInstance<S> implements RunningRound {
  readonly id: string;
  readonly durationMs: number;

  constructor(
    private readonly module: RoundModule<S>,
    private readonly state: S,
  ) {
    this.id = module.id;
    this.durationMs = module.durationMs;
  }

  onInput(input: PlayerInput, ctx: MatchContext): RunningRound {
    const next = this.module.onInput(this.state, input, ctx);
    return next === this.state ? this : new RoundInstance(this.module, next);
  }

  tick(dtMs: number, ctx: MatchContext): RunningRound {
    const next = this.module.tick(this.state, dtMs, ctx);
    return next === this.state ? this : new RoundInstance(this.module, next);
  }

  view(): RoundView {
    return this.module.view(this.state);
  }
  result(): RoundResult {
    return this.module.result(this.state);
  }
}

/** Register any RoundModule<S> without changing the match runner or an id union. */
export function defineRound<S>(module: RoundModule<S>): RoundDefinition {
  if (!module.id.trim() || !Number.isFinite(module.durationMs) || module.durationMs <= 0) {
    throw new Error('Round definitions need a nonempty id and a positive duration.');
  }
  return {
    id: module.id,
    durationMs: module.durationMs,
    start: (ctx) => new RoundInstance(module, module.start(ctx)),
  };
}
