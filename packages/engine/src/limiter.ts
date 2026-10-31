export interface InputWindow {
  readonly window: number;
  readonly atMs: number;
}

export type LimiterState = ReadonlyMap<string, InputWindow>;

export interface LimitResult {
  readonly allowed: boolean;
  readonly state: LimiterState;
}

/** One counted input per viewer per fixed window; ignored commands never commit this state. */
export class InputLimiter {
  constructor(
    readonly windowMs = 2_000,
    readonly originMs = 0,
  ) {
    if (!Number.isFinite(windowMs) || windowMs <= 0 || !Number.isFinite(originMs)) {
      throw new Error('Input windows need a positive duration and a finite origin.');
    }
  }

  start(): LimiterState {
    return new Map();
  }

  consume(state: LimiterState, userId: string, atMs: number): LimitResult {
    if (!Number.isFinite(atMs) || atMs < this.originMs) return { allowed: false, state };
    const window = Math.floor((atMs - this.originMs) / this.windowMs);
    const previous = state.get(userId);
    if (previous && (atMs < previous.atMs || window <= previous.window)) {
      return { allowed: false, state };
    }
    const next = new Map(state);
    next.set(userId, { window, atMs });
    return { allowed: true, state: next };
  }
}
