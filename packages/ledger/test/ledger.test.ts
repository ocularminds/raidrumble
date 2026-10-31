import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Ledger } from '../src/ledger.js';
import { databasePath, record, track } from './fixture.js';

describe('auditable rivalry ledger', () => {
  it('persists a settled match, its receipts and aggregates across reopen', () => {
    const path = databasePath();
    const first = track(new Ledger(path));
    first.settle(record({ startDossierId: 'dossierStart', settleDossierId: 'dossierSettle' }));
    first.close();
    const reopened = track(new Ledger(path));
    expect(reopened.pair('host', 'raider')).toMatchObject({
      matches: 1,
      homeWins: 1,
      raiderWins: 0,
      bossKills: 1,
      streak: { channelId: 'host', count: 1 },
      lastMatchAtMs: 1_000,
    });
    expect(reopened.match('match1')).toMatchObject({
      startDecisionId: 'start1',
      settleDecisionId: 'settle1',
      startDossierId: 'dossierStart',
      settleDossierId: 'dossierSettle',
      unsigned: false,
    });
  });

  it('uses one canonical pair while orienting wins for either queried host', () => {
    const ledger = track(new Ledger());
    ledger.settle(record());
    ledger.settle(
      record({
        matchId: 'match2',
        hostId: 'raider',
        raiderId: 'host',
        winner: 'raiders',
        endedAtMs: 2_000,
      }),
    );
    expect(ledger.pair('host', 'raider')).toMatchObject({ matches: 2, homeWins: 2, raiderWins: 0 });
    expect(ledger.pair('raider', 'host')).toMatchObject({ matches: 2, homeWins: 0, raiderWins: 2 });
    expect(ledger.graph().edges).toHaveLength(1);
    expect(ledger.graph().nodes.map((node) => node.id)).toEqual(['host', 'raider']);
  });

  it('does not increment a replayed match or replace its original audit receipt', () => {
    const ledger = track(new Ledger());
    expect(ledger.settle(record()).inserted).toBe(true);
    const replay = ledger.settle(record({ settleDecisionId: 'retryReceipt' }));
    expect(replay.inserted).toBe(false);
    expect(replay.match.settleDecisionId).toBe('settle1');
    expect(replay.pair.matches).toBe(1);
  });

  it('rejects a conflicting match-id replay without changing any aggregates', () => {
    const ledger = track(new Ledger());
    ledger.settle(record());
    expect(() => ledger.settle(record({ winner: 'raiders' }))).toThrow(/conflict/i);
    expect(() => ledger.settle(record({ raiderId: 'different' }))).toThrow(/conflict/i);
    expect(ledger.pair('host', 'raider')?.matches).toBe(1);
    expect(ledger.pair('host', 'different')).toBeUndefined();
  });

  it('orders streaks by match time even when older settlements arrive later', () => {
    const ledger = track(new Ledger());
    ledger.settle(record({ matchId: 'latest', endedAtMs: 3_000, winner: 'raiders' }));
    ledger.settle(record({ matchId: 'oldest', endedAtMs: 1_000, winner: 'home' }));
    ledger.settle(record({ matchId: 'middle', endedAtMs: 2_000, winner: 'raiders' }));
    expect(ledger.pair('host', 'raider')).toMatchObject({
      matches: 3,
      homeWins: 1,
      raiderWins: 2,
      lastMatchId: 'latest',
      lastMatchAtMs: 3_000,
      streak: { channelId: 'raider', count: 2 },
    });
  });

  it('counts co-op kills independently of competitive wins and breaks a streak on a draw', () => {
    const ledger = track(new Ledger());
    ledger.settle(record());
    ledger.settle(record({ matchId: 'draw', endedAtMs: 2_000, winner: 'both', bossKilled: true }));
    expect(ledger.pair('host', 'raider')).toMatchObject({
      matches: 2,
      homeWins: 1,
      raiderWins: 0,
      bossKills: 2,
      streak: { channelId: null, count: 0 },
    });
  });

  it('marks missing dossiers and explicit local fallback as unsigned', () => {
    const ledger = track(new Ledger());
    const local = ledger.settle(record({ unsigned: false }));
    expect(local.match.unsigned).toBe(true);
    const fallback = ledger.settle(
      record({
        matchId: 'fallback',
        startDossierId: 'start',
        settleDossierId: 'settle',
        unsigned: true,
      }),
    );
    expect(fallback.match.unsigned).toBe(true);
  });

  it('stores only known aggregate fields, never additional viewer lists', () => {
    const path = databasePath();
    const ledger = track(new Ledger(path));
    ledger.settle(
      Object.assign(record(), { viewers: ['privateViewer123'], mvps: ['privateName'] }),
    );
    const database = track(new Database(path));
    const stored = JSON.stringify(database.prepare('SELECT * FROM matches').all());
    expect(stored).not.toContain('privateViewer123');
    expect(stored).not.toContain('privateName');
    expect(stored).toContain('start1');
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    expect(tables).toEqual(expect.arrayContaining([{ name: 'matches' }, { name: 'pairs' }]));
  });

  it('updates retention by match id and keeps earlier match stats separate', () => {
    const ledger = track(new Ledger());
    ledger.settle(record());
    ledger.settle(record({ matchId: 'later', endedAtMs: 2_000 }));
    expect(ledger.retention('match1', 12)).toBe(true);
    expect(ledger.match('match1')?.retention).toBe(12);
    expect(ledger.pair('host', 'raider')?.retention).toBeNull();
    ledger.retention('later', 7);
    expect(ledger.pair('host', 'raider')?.retention).toBe(7);
    expect(ledger.retention('absent', 5)).toBe(false);
    expect(() => ledger.retention('later', -1)).toThrow();
    expect(() => ledger.retention('later', 1.5)).toThrow();
  });

  it('keeps optional gated channel names on graph nodes and pair summaries', () => {
    const ledger = track(new Ledger());
    ledger.settle(record({ hostName: 'Garden Keeper', raiderName: 'Speed Runner' }));
    expect(ledger.graph().nodes).toEqual([
      { id: 'host', name: 'Garden Keeper' },
      { id: 'raider', name: 'Speed Runner' },
    ]);
    expect(ledger.pair('raider', 'host')?.hostName).toBe('Speed Runner');
  });

  it('rejects invalid times, missing receipts, self-pairs and malformed result values', () => {
    const ledger = track(new Ledger());
    for (const bad of [
      record({ endedAtMs: Number.NaN }),
      record({ endedAtMs: -1 }),
      record({ hostId: 'raider' }),
      record({ startDecisionId: '' }),
    ])
      expect(() => ledger.settle(bad)).toThrow();
    expect(ledger.graph().nodes).toEqual([]);
  });
});
