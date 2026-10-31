export type Team = 'home' | 'raiders';
export type Winner = Team | 'both' | 'none';
export type Answer = 'A' | 'B' | 'C';
export type TeamValues = Readonly<Record<Team, number>>;
export type SeededRng = (index: number) => number;

export interface Question {
  readonly id: string;
  readonly about: 'host' | 'raider';
  readonly prompt: string;
  readonly choices: readonly [string, string, string];
  readonly answer: Answer;
  readonly explanation?: string;
}

/** All external display text has passed content.render before entering the engine. */
export interface ContentPack {
  readonly questions: readonly Question[];
  readonly boss: { readonly name: string; readonly flavour: string };
  readonly siegeKeywords: readonly string[];
  readonly weakPoints: readonly string[];
}

export interface SpecialEffect {
  readonly id: 'ram' | 'oil' | 'reinforcements';
  readonly startsAtMs: number;
  readonly endsAtMs: number;
  readonly userId?: string;
}

export interface MatchContext {
  readonly matchId: string;
  readonly seed: number;
  readonly nowMs: number;
  /** Eligible team sizes, frozen per scoring window; these include known lurkers. */
  readonly teams: TeamValues;
  /** Observed participants for boss HP; separate from Siege's eligible team denominator. */
  readonly activeTeams?: TeamValues;
  readonly content: ContentPack;
  /** Indexed randomness is pure: the same index always returns the same value. */
  readonly rng: SeededRng;
  readonly specials?: readonly SpecialEffect[];
}

/** Recognised game commands only. Never forward the original chat message. */
export interface PlayerInput {
  readonly userId: string;
  readonly team: Team;
  readonly kind: 'keyword' | 'answer' | 'hit';
  readonly value: string;
  readonly atMs: number;
  readonly weight?: number;
  readonly displayName?: string;
}

export interface Mvp {
  readonly userId: string;
  readonly contribution: number;
  readonly displayName?: string;
}

export type TeamMvps = Readonly<Record<Team, readonly Mvp[]>>;

export interface RoundView {
  readonly id: string;
  readonly title: string;
  readonly phase: 'active' | 'reveal' | 'finished';
  readonly elapsedMs: number;
  readonly durationMs: number;
  readonly remainingMs: number;
  readonly keyword: string;
  readonly instruction: string;
  readonly progress: number;
  readonly scores: TeamValues;
  readonly gate?: { readonly position: number; readonly force: TeamValues };
  readonly quiz?: {
    readonly index: number;
    readonly total: number;
    readonly prompt: string;
    readonly choices: readonly [string, string, string];
    readonly scoringTeam: Team;
    readonly answer?: Answer;
    readonly explanation?: string;
  };
  readonly boss?: {
    readonly name: string;
    readonly flavour: string;
    readonly hp: number;
    readonly maxHp: number;
    readonly weakPoint: string;
    readonly weakPointActive: boolean;
    readonly weakPointRemainingMs: number;
  };
  readonly mvps?: TeamMvps;
}

export interface RoundResult {
  readonly roundId: string;
  readonly winner: Winner;
  readonly mvps: TeamMvps;
  readonly stats: Readonly<Record<string, number>>;
}

/** Returning the identical state from onInput means the input was not counted. */
export interface RoundModule<S> {
  readonly id: string;
  readonly durationMs: number;
  start(ctx: MatchContext): S;
  onInput(state: S, input: PlayerInput, ctx: MatchContext): S;
  tick(state: S, dtMs: number, ctx: MatchContext): S;
  view(state: S): RoundView;
  result(state: S): RoundResult;
}

export interface MatchView {
  readonly matchId: string;
  readonly status: 'playing' | 'endcard' | 'finished';
  readonly elapsedMs: number;
  readonly remainingMs: number;
  readonly roundIndex: number;
  readonly roundCount: number;
  readonly round?: RoundView;
  readonly results: readonly RoundResult[];
  readonly winner: Winner;
  readonly teams: TeamValues;
  readonly degraded: boolean;
  /** Ephemeral counted moves only; omitted for quiz/end card. Never persist this projection. */
  readonly feedback?: MatchFeedback;
}

export interface ContributorPop {
  /** Round-local sequence; pair with feedback.roundId. Never a viewer identifier. */
  readonly id: number;
  readonly team: Team;
  /** Only display names already approved through ContentService.name. */
  readonly displayName: string;
  /** One counted move, independent of reinforcement weight or boss damage. */
  readonly amount: 1;
  /** Match-relative timestamps; the pop disappears after 1,600 ms. */
  readonly atMs: number;
  readonly expiresAtMs: number;
}

export interface ContributorStreak {
  readonly displayName: string;
  /** Consecutive 2-second windows with a counted move; a missed window resets it. */
  readonly count: number;
}

export interface MatchFeedback {
  readonly roundId: string;
  /** At most six recent moves per team, ordered oldest first. */
  readonly pops: readonly ContributorPop[];
  readonly streaks: Readonly<Record<Team, readonly ContributorStreak[]>>;
}
