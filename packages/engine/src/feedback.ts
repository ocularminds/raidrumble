import type { ContributorPop, MatchFeedback, PlayerInput, Team } from './model.js';

interface Streak {
  readonly team: Team;
  readonly displayName: string;
  readonly count: number;
  readonly window: number;
}

export interface ContributorState {
  readonly roundId: string;
  readonly sequence: number;
  readonly pops: readonly ContributorPop[];
  /** Ephemeral identity lookup, discarded after a missed window or at the round boundary. */
  readonly participants: ReadonlyMap<string, Streak>;
}

/** Pure, caller-owned feedback. Invoke count only after the timeline accepts an input. */
export class Contributors {
  start(roundId: string): ContributorState {
    return { roundId, sequence: 0, pops: [], participants: new Map() };
  }

  count(state: ContributorState, input: PlayerInput, elapsedMs: number): ContributorState {
    const next = this.tick(state, elapsedMs);
    if (!input.displayName?.trim() || !Number.isFinite(elapsedMs) || elapsedMs < 0) return next;
    const window = Math.floor(elapsedMs / 2000);
    const previous = next.participants.get(input.userId);
    const consecutive = previous?.team === input.team && previous.window === window - 1;
    const repeated = previous?.team === input.team && previous.window === window;
    if (repeated) return next;
    const participants = new Map(next.participants);
    participants.set(input.userId, {
      team: input.team,
      displayName: input.displayName,
      count: consecutive ? previous.count + 1 : 1,
      window,
    });
    const pop: ContributorPop = {
      id: next.sequence + 1,
      team: input.team,
      displayName: input.displayName,
      amount: 1,
      atMs: elapsedMs,
      expiresAtMs: elapsedMs + 1600,
    };
    const pops = [...next.pops, pop];
    const oldest = pops.filter((item) => item.team === input.team).at(-6)?.id ?? 0;
    return {
      ...next,
      sequence: pop.id,
      participants,
      pops: pops.filter((item) => item.team !== input.team || item.id >= oldest),
    };
  }

  tick(state: ContributorState, elapsedMs: number): ContributorState {
    const window = Math.floor(elapsedMs / 2000);
    const pops = state.pops.filter((pop) => pop.expiresAtMs > elapsedMs);
    const participants = new Map(
      [...state.participants].filter(([, streak]) => streak.window >= window - 1),
    );
    return pops.length === state.pops.length && participants.size === state.participants.size
      ? state
      : { ...state, pops, participants };
  }

  view(state: ContributorState, elapsedMs: number): MatchFeedback {
    const next = this.tick(state, elapsedMs);
    const top = (team: Team) =>
      [...next.participants]
        .filter(([, streak]) => streak.team === team)
        .sort(
          ([leftId, left], [rightId, right]) =>
            right.count - left.count || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0),
        )
        .slice(0, 3)
        .map(([, { displayName, count }]) => ({ displayName, count }));
    return {
      roundId: next.roundId,
      pops: next.pops,
      streaks: { home: top('home'), raiders: top('raiders') },
    };
  }
}
