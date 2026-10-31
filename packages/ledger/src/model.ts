import type { Winner } from '@raidrumble/engine';

/** Only aggregate game data and channel identities belong in durable rivalry records. */
export interface MatchRecord {
  readonly matchId: string;
  readonly hostId: string;
  readonly raiderId: string;
  /** Optional channel names must already have passed content.render. */
  readonly hostName?: string;
  readonly raiderName?: string;
  readonly winner: Winner;
  readonly bossKilled: boolean;
  readonly endedAtMs: number;
  readonly startDecisionId: string;
  readonly settleDecisionId: string;
  readonly startDossierId?: string;
  readonly settleDossierId?: string;
  readonly unsigned?: boolean;
}

export interface StoredMatch extends MatchRecord {
  readonly unsigned: boolean;
  readonly retention: number | null;
}

export interface PairSummary {
  readonly hostId: string;
  readonly raiderId: string;
  readonly hostName?: string;
  readonly raiderName?: string;
  readonly matches: number;
  readonly homeWins: number;
  readonly raiderWins: number;
  readonly bossKills: number;
  readonly streak: { readonly channelId: string | null; readonly count: number };
  readonly lastMatchAtMs: number;
  readonly lastMatchId: string;
  readonly retention: number | null;
}

export interface SettlementResult {
  readonly inserted: boolean;
  readonly match: StoredMatch;
  readonly pair: PairSummary;
}

export interface RivalryGraph {
  readonly nodes: readonly { readonly id: string; readonly name?: string }[];
  readonly edges: readonly {
    readonly source: string;
    readonly target: string;
    readonly matches: number;
    readonly sourceWins: number;
    readonly targetWins: number;
    readonly bossKills: number;
    readonly lastMatchAtMs: number;
  }[];
}

export type SettlementInput = Omit<
  MatchRecord,
  'settleDecisionId' | 'settleDossierId' | 'unsigned'
>;

export interface AfterglowView {
  readonly count: number;
  readonly remainingMs: number;
  readonly finished: boolean;
  readonly finalCount?: number;
}
