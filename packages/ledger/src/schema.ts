export const ledgerSchema = `
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT,
  updated_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  match_id TEXT PRIMARY KEY,
  left_id TEXT NOT NULL,
  right_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  raider_id TEXT NOT NULL,
  host_name TEXT,
  raider_name TEXT,
  winner TEXT NOT NULL CHECK (winner IN ('home', 'raiders', 'both', 'none')),
  winner_id TEXT,
  boss_killed INTEGER NOT NULL CHECK (boss_killed IN (0, 1)),
  ended_at_ms INTEGER NOT NULL CHECK (ended_at_ms >= 0),
  start_decision_id TEXT NOT NULL,
  settle_decision_id TEXT NOT NULL,
  start_dossier_id TEXT,
  settle_dossier_id TEXT,
  unsigned INTEGER NOT NULL CHECK (unsigned IN (0, 1)),
  retention INTEGER CHECK (retention IS NULL OR retention >= 0),
  CHECK (host_id <> raider_id),
  FOREIGN KEY (host_id) REFERENCES channels(id),
  FOREIGN KEY (raider_id) REFERENCES channels(id)
);
CREATE INDEX IF NOT EXISTS matches_pair_time ON matches(left_id, right_id, ended_at_ms DESC, match_id DESC);
CREATE TABLE IF NOT EXISTS pairs (
  left_id TEXT NOT NULL,
  right_id TEXT NOT NULL,
  matches INTEGER NOT NULL,
  left_wins INTEGER NOT NULL,
  right_wins INTEGER NOT NULL,
  boss_kills INTEGER NOT NULL,
  streak_channel TEXT,
  streak_count INTEGER NOT NULL,
  last_match_id TEXT NOT NULL,
  last_match_at_ms INTEGER NOT NULL,
  PRIMARY KEY (left_id, right_id),
  FOREIGN KEY (left_id) REFERENCES channels(id),
  FOREIGN KEY (right_id) REFERENCES channels(id),
  FOREIGN KEY (last_match_id) REFERENCES matches(match_id)
);
`;

export interface MatchRow {
  match_id: string;
  left_id: string;
  right_id: string;
  host_id: string;
  raider_id: string;
  host_name: string | null;
  raider_name: string | null;
  winner: 'home' | 'raiders' | 'both' | 'none';
  winner_id: string | null;
  boss_killed: number;
  ended_at_ms: number;
  start_decision_id: string;
  settle_decision_id: string;
  start_dossier_id: string | null;
  settle_dossier_id: string | null;
  unsigned: number;
  retention: number | null;
}

export interface PairRow {
  left_id: string;
  right_id: string;
  left_name: string | null;
  right_name: string | null;
  matches: number;
  left_wins: number;
  right_wins: number;
  boss_kills: number;
  streak_channel: string | null;
  streak_count: number;
  last_match_id: string;
  last_match_at_ms: number;
  retention: number | null;
}
