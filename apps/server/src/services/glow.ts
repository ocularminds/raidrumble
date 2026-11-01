import { AfterglowTracker } from '@raidrumble/ledger';
import type { ArchiveKey, MatchArchive } from './archive.js';

interface GlowEntry {
  key: ArchiveKey;
  endedAtMs: number;
  clock: { now: number };
  tracker: AfterglowTracker;
  members: Set<string>;
  nextPulse: number;
  simulated: boolean;
  settled: Promise<boolean>;
  persistent: boolean;
}

/** Completed matches retain independent windows even while a newer game is running. */
export class GlowHistory {
  private readonly entries = new Map<string, GlowEntry>();
  constructor(private readonly archive: MatchArchive) {}

  add(
    key: ArchiveKey,
    endedAtMs: number,
    seen: ReadonlyMap<string, number>,
    members: ReadonlySet<string>,
    simulated: boolean,
    settled: Promise<boolean>,
    persistent = true,
  ): void {
    const clock = { now: endedAtMs };
    const tracker = new AfterglowTracker(endedAtMs, () => clock.now);
    for (const [userId, atMs] of seen) tracker.observe(userId, 'raiders', atMs);
    this.entries.set(key.matchId, {
      key,
      endedAtMs,
      clock,
      tracker,
      members: new Set(members),
      simulated,
      settled,
      persistent,
      nextPulse: endedAtMs + 2_000,
    });
  }

  step(now: number): void {
    for (const [matchId, entry] of this.entries) {
      if (entry.simulated) {
        const end = entry.endedAtMs + entry.tracker.durationMs;
        while (entry.nextPulse <= now && entry.nextPulse < end) {
          entry.clock.now = entry.nextPulse;
          for (let index = 0; index < 8; index += 1)
            entry.tracker.observe(`raider${index}`, 'raiders');
          entry.nextPulse += 2_000;
        }
      }
      entry.clock.now = now;
      const view = entry.tracker.view();
      if (view.finished) {
        if (entry.persistent)
          this.archive.retention(entry.key, view.finalCount ?? view.count, entry.settled);
        entry.members.clear();
        this.entries.delete(matchId);
      }
    }
  }

  observe(userId: string, now: number): void {
    for (const entry of this.entries.values()) {
      if (!entry.members.has(userId)) continue;
      entry.clock.now = now;
      entry.tracker.observe(userId, 'raiders');
    }
  }

  view(): { count: number; remainingMs: number } | undefined {
    const latest = [...this.entries.values()].at(-1);
    if (!latest) return undefined;
    const view = latest.tracker.view();
    return { count: view.count, remainingMs: view.remainingMs };
  }

  clear(): void {
    this.entries.clear();
  }
}
