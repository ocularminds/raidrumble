export type RosterState = ReadonlyMap<string, number>;

/** Ephemeral recent-chat roster. The server discards each state after its match. */
export class RosterCapture {
  readonly durationMs = 30 * 60 * 1_000;

  start(): RosterState {
    return new Map();
  }

  record(state: RosterState, userId: string, atMs: number): RosterState {
    if (!Number.isFinite(atMs) || atMs < 0) return state;
    const cutoff = atMs - this.durationMs;
    const next = new Map([...state].filter(([, time]) => time >= cutoff));
    next.set(userId, Math.max(atMs, state.get(userId) ?? atMs));
    return next;
  }

  snapshot(state: RosterState, raidAtMs: number): ReadonlySet<string> {
    const cutoff = raidAtMs - this.durationMs;
    return new Set(
      [...state].filter(([, time]) => time >= cutoff && time <= raidAtMs).map(([userId]) => userId),
    );
  }

  discard(): RosterState {
    return this.start();
  }
}
