import { afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MatchRecord } from '../src/model.js';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
});

export function track<T extends { close(): void }>(resource: T): T {
  cleanup.push(() => resource.close());
  return resource;
}

export function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'raidrumble'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'rivalry.sqlite');
}

export function record(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    matchId: 'match1',
    hostId: 'host',
    raiderId: 'raider',
    winner: 'home',
    bossKilled: true,
    endedAtMs: 1_000,
    startDecisionId: 'start1',
    settleDecisionId: 'settle1',
    ...overrides,
  };
}
