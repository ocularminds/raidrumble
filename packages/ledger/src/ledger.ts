import Database from 'better-sqlite3';
import type {
  MatchRecord,
  PairSummary,
  RivalryGraph,
  SettlementResult,
  StoredMatch,
} from './model.js';
import { ledgerSchema, type MatchRow, type PairRow } from './schema.js';

/** SQLite storage. Invoke settlement and retention writes from the policy executor. */
export class Ledger {
  private readonly database: Database.Database;

  constructor(path = ':memory:') {
    this.database = new Database(path);
    this.database.pragma('foreign_keys = ON');
    this.database.pragma('journal_mode = WAL');
    this.database.exec(ledgerSchema);
  }

  settle(record: MatchRecord): SettlementResult {
    this.validate(record);
    return this.database.transaction(() => {
      const existing = this.match(record.matchId);
      if (existing) {
        if (!this.sameMatch(existing, record)) throw new Error('Conflicting match-id replay.');
        return this.settlement(existing, false);
      }
      const [left, right] = this.canonical(record.hostId, record.raiderId);
      this.channel(record.hostId, record.hostName, record.endedAtMs);
      this.channel(record.raiderId, record.raiderName, record.endedAtMs);
      this.database
        .prepare(
          `INSERT INTO matches (
        match_id,left_id,right_id,host_id,raider_id,host_name,raider_name,winner,winner_id,
        boss_killed,ended_at_ms,start_decision_id,settle_decision_id,start_dossier_id,settle_dossier_id,unsigned
      ) VALUES (@matchId,@left,@right,@hostId,@raiderId,@hostName,@raiderName,@winner,@winnerId,
        @bossKilled,@endedAtMs,@startDecisionId,@settleDecisionId,@startDossierId,@settleDossierId,@unsigned)`,
        )
        .run({
          matchId: record.matchId,
          left,
          right,
          hostId: record.hostId,
          raiderId: record.raiderId,
          hostName: record.hostName ?? null,
          raiderName: record.raiderName ?? null,
          winner: record.winner,
          winnerId:
            record.winner === 'home'
              ? record.hostId
              : record.winner === 'raiders'
                ? record.raiderId
                : null,
          bossKilled: Number(record.bossKilled),
          endedAtMs: record.endedAtMs,
          startDecisionId: record.startDecisionId,
          settleDecisionId: record.settleDecisionId,
          startDossierId: record.startDossierId ?? null,
          settleDossierId: record.settleDossierId ?? null,
          unsigned: Number(
            record.unsigned === true || !record.startDossierId || !record.settleDossierId,
          ),
        });
      this.refresh(left, right);
      const stored = this.match(record.matchId);
      if (!stored) throw new Error('Settlement was not stored.');
      return this.settlement(stored, true);
    })();
  }

  match(matchId: string): StoredMatch | undefined {
    const row = this.database
      .prepare<[string], MatchRow>('SELECT * FROM matches WHERE match_id = ?')
      .get(matchId);
    if (!row) return undefined;
    return {
      matchId: row.match_id,
      hostId: row.host_id,
      raiderId: row.raider_id,
      winner: row.winner,
      bossKilled: row.boss_killed === 1,
      endedAtMs: row.ended_at_ms,
      startDecisionId: row.start_decision_id,
      settleDecisionId: row.settle_decision_id,
      unsigned: row.unsigned === 1,
      retention: row.retention,
      ...(row.host_name !== null ? { hostName: row.host_name } : {}),
      ...(row.raider_name !== null ? { raiderName: row.raider_name } : {}),
      ...(row.start_dossier_id !== null ? { startDossierId: row.start_dossier_id } : {}),
      ...(row.settle_dossier_id !== null ? { settleDossierId: row.settle_dossier_id } : {}),
    };
  }

  pair(hostId: string, raiderId: string): PairSummary | undefined {
    const [left, right] = this.canonical(hostId, raiderId);
    const row = this.database
      .prepare<[string, string], PairRow>(
        `
      SELECT p.*, l.name AS left_name, r.name AS right_name, m.retention FROM pairs p
      JOIN channels l ON l.id=p.left_id JOIN channels r ON r.id=p.right_id
      JOIN matches m ON m.match_id=p.last_match_id WHERE p.left_id=? AND p.right_id=?
    `,
      )
      .get(left, right);
    if (!row) return undefined;
    const hostLeft = hostId === left;
    const hostName = hostLeft ? row.left_name : row.right_name;
    const raiderName = hostLeft ? row.right_name : row.left_name;
    return {
      hostId,
      raiderId,
      matches: row.matches,
      homeWins: hostLeft ? row.left_wins : row.right_wins,
      raiderWins: hostLeft ? row.right_wins : row.left_wins,
      bossKills: row.boss_kills,
      streak: { channelId: row.streak_channel, count: row.streak_count },
      lastMatchAtMs: row.last_match_at_ms,
      lastMatchId: row.last_match_id,
      retention: row.retention,
      ...(hostName !== null ? { hostName } : {}),
      ...(raiderName !== null ? { raiderName } : {}),
    };
  }

  graph(): RivalryGraph {
    const nodes = this.database
      .prepare<[], { id: string; name: string | null }>('SELECT id,name FROM channels ORDER BY id')
      .all()
      .map(({ id, name }) => ({ id, ...(name !== null ? { name } : {}) }));
    const edges = this.database
      .prepare<[], PairRow>('SELECT * FROM pairs ORDER BY left_id,right_id')
      .all()
      .map((row) => ({
        source: row.left_id,
        target: row.right_id,
        matches: row.matches,
        sourceWins: row.left_wins,
        targetWins: row.right_wins,
        bossKills: row.boss_kills,
        lastMatchAtMs: row.last_match_at_ms,
      }));
    return { nodes, edges };
  }

  retention(matchId: string, count: number): boolean {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error('Retention must be a nonnegative integer.');
    return (
      this.database.prepare('UPDATE matches SET retention=? WHERE match_id=?').run(count, matchId)
        .changes > 0
    );
  }

  close(): void {
    if (this.database.open) this.database.close();
  }

  private canonical(hostId: string, raiderId: string): readonly [string, string] {
    return hostId < raiderId ? [hostId, raiderId] : [raiderId, hostId];
  }

  private validate(record: MatchRecord): void {
    const values = [
      record.matchId,
      record.hostId,
      record.raiderId,
      record.startDecisionId,
      record.settleDecisionId,
    ];
    if (values.some((value) => typeof value !== 'string' || !value.trim() || value.length > 256)) {
      throw new Error('A settlement requires channel, match and policy decision identifiers.');
    }
    if (
      record.hostId === record.raiderId ||
      !Number.isSafeInteger(record.endedAtMs) ||
      record.endedAtMs < 0 ||
      !['home', 'raiders', 'both', 'none'].includes(record.winner) ||
      typeof record.bossKilled !== 'boolean'
    ) {
      throw new Error('Invalid settlement result.');
    }
    for (const text of [
      record.hostName,
      record.raiderName,
      record.startDossierId,
      record.settleDossierId,
    ]) {
      if (text !== undefined && (typeof text !== 'string' || !text.trim() || text.length > 256)) {
        throw new Error('Invalid optional settlement metadata.');
      }
    }
  }

  private sameMatch(stored: StoredMatch, incoming: MatchRecord): boolean {
    return (
      stored.hostId === incoming.hostId &&
      stored.raiderId === incoming.raiderId &&
      stored.winner === incoming.winner &&
      stored.bossKilled === incoming.bossKilled &&
      stored.endedAtMs === incoming.endedAtMs &&
      stored.startDecisionId === incoming.startDecisionId &&
      stored.startDossierId === incoming.startDossierId
    );
  }

  private settlement(match: StoredMatch, inserted: boolean): SettlementResult {
    const pair = this.pair(match.hostId, match.raiderId);
    if (!pair) throw new Error('Rivalry aggregate is missing.');
    return { inserted, match, pair };
  }

  private channel(id: string, name: string | undefined, atMs: number): void {
    this.database
      .prepare(
        `INSERT INTO channels(id,name,updated_at_ms) VALUES(?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=COALESCE(excluded.name,channels.name),updated_at_ms=excluded.updated_at_ms
      WHERE excluded.updated_at_ms >= channels.updated_at_ms`,
      )
      .run(id, name ?? null, atMs);
  }

  private refresh(left: string, right: string): void {
    const history = this.database
      .prepare<[string, string], Pick<MatchRow, 'match_id' | 'winner_id' | 'ended_at_ms'>>(
        'SELECT match_id,winner_id,ended_at_ms FROM matches WHERE left_id=? AND right_id=? ORDER BY ended_at_ms DESC,match_id DESC',
      )
      .all(left, right);
    const latest = history[0];
    if (!latest) throw new Error('Cannot aggregate an empty rivalry.');
    let streak = 0;
    if (latest.winner_id !== null) {
      for (const match of history) {
        if (match.winner_id !== latest.winner_id) break;
        streak += 1;
      }
    }
    const total = this.database
      .prepare<
        [string, string],
        { matches: number; leftWins: number; rightWins: number; bossKills: number }
      >(
        `
      SELECT COUNT(*) AS matches,SUM(winner_id=left_id) AS leftWins,SUM(winner_id=right_id) AS rightWins,
      SUM(boss_killed) AS bossKills FROM matches WHERE left_id=? AND right_id=?
    `,
      )
      .get(left, right);
    if (!total) throw new Error('Cannot aggregate settlement.');
    this.database
      .prepare(
        `INSERT INTO pairs (
      left_id,right_id,matches,left_wins,right_wins,boss_kills,streak_channel,streak_count,last_match_id,last_match_at_ms
    ) VALUES (@left,@right,@matches,@leftWins,@rightWins,@bossKills,@streakChannel,@streak,@latestId,@latestTime)
    ON CONFLICT(left_id,right_id) DO UPDATE SET matches=excluded.matches,left_wins=excluded.left_wins,
      right_wins=excluded.right_wins,boss_kills=excluded.boss_kills,streak_channel=excluded.streak_channel,
      streak_count=excluded.streak_count,last_match_id=excluded.last_match_id,last_match_at_ms=excluded.last_match_at_ms`,
      )
      .run({
        left,
        right,
        matches: total.matches,
        leftWins: total.leftWins ?? 0,
        rightWins: total.rightWins ?? 0,
        bossKills: total.bossKills,
        streakChannel: latest.winner_id,
        streak,
        latestId: latest.match_id,
        latestTime: latest.ended_at_ms,
      });
  }
}
