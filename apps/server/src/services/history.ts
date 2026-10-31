import { createHmac, randomBytes } from 'node:crypto';
import type { RegularStore } from '@raidrumble/ledger';

interface SeenViewer {
  firstAtMs: number;
  isRegular: boolean | undefined;
  recent: number[];
}

/** First-seen metadata is keyed by ephemeral hashes, never raw viewer IDs or message text. */
export class HostHistory {
  private readonly salt = randomBytes(32);
  private readonly seen = new Map<string, SeenViewer>();
  private streamId: string | undefined;

  constructor(
    private readonly hostId: string,
    private readonly regulars: RegularStore | undefined,
    private readonly now: () => number,
  ) {}

  beginStream(streamId: string): void {
    if (this.streamId === streamId) return;
    this.streamId = streamId;
    this.seen.clear();
    this.regulars?.beginStream(this.hostId, streamId);
  }

  observe(userId: string, occurredAt?: number): SeenViewer {
    const now = this.now();
    const atMs =
      occurredAt !== undefined && Number.isFinite(occurredAt) ? Math.min(now, occurredAt) : now;
    const key = createHmac('sha256', this.salt).update(userId).digest('hex');
    const known = this.seen.get(key);
    if (known) {
      known.firstAtMs = Math.min(known.firstAtMs, atMs);
      this.remember(known, atMs, now);
      return { ...known };
    }
    let isRegular: boolean | undefined;
    try {
      isRegular = this.regulars?.has(this.hostId, userId);
      this.regulars?.observe(this.hostId, userId);
    } catch {
      /* A missing regular signal must not become invented evidence for Raiders. */
    }
    if (this.seen.size >= 50_000) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    const value = { firstAtMs: atMs, isRegular, recent: [atMs] };
    this.seen.set(key, value);
    return { ...value };
  }

  clear(): void {
    this.seen.clear();
  }

  recentCount(atMs: number): number {
    return [...this.seen.values()].filter((viewer) =>
      viewer.recent.some((time) => time >= atMs - 120_000 && time <= atMs),
    ).length;
  }

  private remember(viewer: SeenViewer, atMs: number, now: number): void {
    const index = viewer.recent.findIndex(
      (time) => Math.floor(time / 2_000) === Math.floor(atMs / 2_000),
    );
    if (index < 0) viewer.recent.push(atMs);
    else viewer.recent[index] = Math.min(viewer.recent[index] ?? atMs, atMs);
    viewer.recent = viewer.recent.filter((time) => time >= now - 150_000).slice(-76);
  }
}
