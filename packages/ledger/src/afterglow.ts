import type { Team } from '@raidrumble/engine';
import type { AfterglowView } from './model.js';

/** Ephemeral viewer timestamps; only finalCount is eligible for ledger persistence. */
export class AfterglowTracker {
  readonly durationMs = 300_000;
  readonly activeWindowMs = 120_000;
  private readonly viewers = new Map<string, number>();
  private finalCount: number | undefined;

  constructor(
    readonly endedAtMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isFinite(endedAtMs) || endedAtMs < 0)
      throw new Error('Invalid Afterglow start time.');
  }

  get size(): number {
    return this.viewers.size;
  }

  observe(userId: string, team: Team, atMs = this.now()): void {
    const now = this.now();
    this.finish(now);
    if (
      this.finalCount !== undefined ||
      !Number.isFinite(atMs) ||
      atMs > now ||
      atMs < now - this.activeWindowMs ||
      atMs < (this.viewers.get(userId) ?? -Infinity)
    )
      return;
    if (team === 'raiders') this.viewers.set(userId, atMs);
    else this.viewers.delete(userId);
  }

  view(): AfterglowView {
    const now = this.now();
    this.finish(now);
    if (this.finalCount !== undefined) {
      return {
        count: this.finalCount,
        remainingMs: 0,
        finished: true,
        finalCount: this.finalCount,
      };
    }
    this.prune(now);
    return {
      count: this.viewers.size,
      finished: false,
      remainingMs: Math.min(this.durationMs, Math.max(0, this.endedAtMs + this.durationMs - now)),
    };
  }

  private finish(now: number): void {
    const deadline = this.endedAtMs + this.durationMs;
    if (this.finalCount !== undefined || now < deadline) return;
    this.prune(deadline);
    this.finalCount = this.viewers.size;
    this.viewers.clear();
  }

  private prune(atMs: number): void {
    for (const [userId, lastSeen] of this.viewers) {
      if (lastSeen < atMs - this.activeWindowMs || lastSeen > atMs) this.viewers.delete(userId);
    }
  }
}
