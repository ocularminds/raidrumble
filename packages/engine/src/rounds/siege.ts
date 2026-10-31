import type {
  MatchContext,
  Mvp,
  PlayerInput,
  RoundModule,
  RoundResult,
  RoundView,
  SpecialEffect,
  Team,
  TeamMvps,
  TeamValues,
} from '../model.js';

const WINDOW_MS = 2_000;
const KEYWORD_MS = 10_000;
const FLOOR = 5;

interface Participant extends Mvp {
  readonly team: Team;
}

export interface SiegeState {
  readonly startedAtMs: number;
  readonly elapsedMs: number;
  readonly windowStartMs: number;
  readonly windows: number;
  readonly eligible: TeamValues;
  readonly counts: TeamValues;
  readonly force: TeamValues;
  readonly totals: TeamValues;
  readonly weights: TeamValues;
  readonly gatePosition: number;
  readonly keywords: readonly string[];
  readonly keywordOffset: number;
  readonly effects: readonly SpecialEffect[];
  readonly participants: ReadonlyMap<string, Participant>;
}

/** Stateless plug-in; the timeline owns rate limiting and the caller owns state. */
export class SiegeRound implements RoundModule<SiegeState> {
  readonly id = 'siege';
  readonly durationMs = 60_000;

  start(ctx: MatchContext): SiegeState {
    const supplied = ctx.content.siegeKeywords.filter((keyword) => keyword.trim().length > 0);
    const keywords = supplied.length ? [...supplied] : ['PUSH', 'HOLD', 'RALLY'];
    const random = ctx.rng(0);
    const keywordOffset = Number.isFinite(random)
      ? Math.min(keywords.length - 1, Math.max(0, Math.floor(random * keywords.length)))
      : 0;
    return {
      startedAtMs: ctx.nowMs,
      elapsedMs: 0,
      windowStartMs: 0,
      windows: 0,
      eligible: this.teamSizes(ctx.teams),
      counts: { home: 0, raiders: 0 },
      force: { home: 0, raiders: 0 },
      totals: { home: 0, raiders: 0 },
      weights: { home: 0, raiders: 0 },
      gatePosition: 0.5,
      keywords,
      keywordOffset,
      effects: this.collectEffects([], ctx.specials ?? []),
      participants: new Map(),
    };
  }

  onInput(state: SiegeState, input: PlayerInput, ctx: MatchContext): SiegeState {
    if (
      state.elapsedMs >= this.durationMs ||
      input.kind !== 'keyword' ||
      input.value.trim().toUpperCase() !== this.keyword(state).toUpperCase() ||
      !Number.isFinite(input.atMs) ||
      input.atMs < state.startedAtMs + state.elapsedMs ||
      input.atMs >= state.startedAtMs + state.windowStartMs + WINDOW_MS
    )
      return state;
    const effects = this.collectEffects(state.effects, ctx.specials ?? []);
    const reinforced = effects.some(
      (effect) =>
        effect.id === 'reinforcements' &&
        effect.userId === input.userId &&
        this.active(effect, input.atMs),
    );
    const provided = Number.isFinite(input.weight)
      ? Math.max(1, Math.min(2, input.weight ?? 1))
      : 1;
    const weight = reinforced ? 2 : provided;
    const participants = new Map(state.participants);
    const key = `${input.team}:${input.userId}`;
    const previous = participants.get(key);
    participants.set(key, {
      userId: input.userId,
      team: input.team,
      contribution: (previous?.contribution ?? 0) + weight,
      ...(input.displayName !== undefined
        ? { displayName: input.displayName }
        : previous?.displayName !== undefined
          ? { displayName: previous.displayName }
          : {}),
    });
    return {
      ...state,
      effects,
      participants,
      counts: { ...state.counts, [input.team]: state.counts[input.team] + weight },
      weights: { ...state.weights, [input.team]: state.weights[input.team] + weight },
    };
  }

  tick(state: SiegeState, dtMs: number, ctx: MatchContext): SiegeState {
    if (state.elapsedMs >= this.durationMs || !Number.isFinite(dtMs) || dtMs <= 0) return state;
    const elapsedMs = Math.min(this.durationMs, state.elapsedMs + dtMs);
    let next: SiegeState = {
      ...state,
      effects: this.collectEffects(state.effects, ctx.specials ?? []),
    };
    while (next.windowStartMs + WINDOW_MS <= elapsedMs) next = this.settle(next, ctx.teams);
    return { ...next, elapsedMs };
  }

  view(state: SiegeState): RoundView {
    const keyword = this.keyword(state);
    return {
      id: this.id,
      title: 'Siege',
      phase: state.elapsedMs >= this.durationMs ? 'finished' : 'active',
      elapsedMs: state.elapsedMs,
      durationMs: this.durationMs,
      remainingMs: this.durationMs - state.elapsedMs,
      keyword,
      instruction: `Type ${keyword} · one move every 2 seconds`,
      progress: state.gatePosition,
      scores: this.scores(state),
      gate: { position: state.gatePosition, force: state.force },
      mvps: this.mvps(state),
    };
  }

  result(state: SiegeState): RoundResult {
    const scores = this.scores(state);
    const difference = state.gatePosition - 0.5;
    return {
      roundId: this.id,
      winner: Math.abs(difference) < 1e-9 ? 'none' : difference > 0 ? 'raiders' : 'home',
      mvps: this.mvps(state),
      stats: {
        gatePosition: state.gatePosition,
        homeParticipation: scores.home,
        raiderParticipation: scores.raiders,
        homeWeight: state.weights.home,
        raiderWeight: state.weights.raiders,
        windows: state.windows,
      },
    };
  }

  private settle(state: SiegeState, nextTeams: TeamValues): SiegeState {
    const start = state.startedAtMs + state.windowStartMs;
    const force = {
      home: state.counts.home / Math.max(FLOOR, state.eligible.home),
      raiders:
        (state.counts.raiders / Math.max(FLOOR, state.eligible.raiders)) *
        this.raiderMultiplier(state.effects, start, start + WINDOW_MS),
    };
    const totals = {
      home: state.totals.home + force.home,
      raiders: state.totals.raiders + force.raiders,
    };
    // Full participation by one team alone takes the complete round to move from centre to its endpoint.
    const gatePosition = Math.max(0, Math.min(1, 0.5 + (totals.raiders - totals.home) / 60));
    return {
      ...state,
      windowStartMs: state.windowStartMs + WINDOW_MS,
      windows: state.windows + 1,
      counts: { home: 0, raiders: 0 },
      eligible: this.teamSizes(nextTeams),
      force,
      totals,
      gatePosition,
    };
  }

  private keyword(state: SiegeState): string {
    const rotation = Math.floor(Math.min(state.elapsedMs, this.durationMs - 1) / KEYWORD_MS);
    return state.keywords[(state.keywordOffset + rotation) % state.keywords.length] ?? 'PUSH';
  }

  private teamSizes(teams: TeamValues): TeamValues {
    return {
      home: Number.isFinite(teams.home) ? Math.max(0, teams.home) : 0,
      raiders: Number.isFinite(teams.raiders) ? Math.max(0, teams.raiders) : 0,
    };
  }

  private scores(state: SiegeState): TeamValues {
    const windows = Math.max(1, state.windows);
    return { home: state.totals.home / windows, raiders: state.totals.raiders / windows };
  }

  private mvps(state: SiegeState): TeamMvps {
    const rank = (team: Team): readonly Mvp[] =>
      [...state.participants.values()]
        .filter((participant) => participant.team === team)
        .sort(
          (left, right) =>
            right.contribution - left.contribution ||
            (left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0),
        )
        .slice(0, 3)
        .map(({ userId, contribution, displayName }) => ({
          userId,
          contribution,
          ...(displayName !== undefined ? { displayName } : {}),
        }));
    return { home: rank('home'), raiders: rank('raiders') };
  }

  private collectEffects(
    previous: readonly SpecialEffect[],
    supplied: readonly SpecialEffect[],
  ): readonly SpecialEffect[] {
    const effects = [...previous];
    for (const effect of supplied) {
      if (
        !Number.isFinite(effect.startsAtMs) ||
        !Number.isFinite(effect.endsAtMs) ||
        (effect.id === 'reinforcements' && !effect.userId) ||
        effects.some(
          (known) =>
            known.id === effect.id &&
            (effect.id !== 'reinforcements' || known.userId === effect.userId),
        )
      )
        continue;
      const duration = effect.id === 'reinforcements' ? 10_000 : 5_000;
      const endsAtMs = Math.min(effect.endsAtMs, effect.startsAtMs + duration);
      if (endsAtMs > effect.startsAtMs) effects.push({ ...effect, endsAtMs });
    }
    return effects;
  }

  private active(effect: SpecialEffect, atMs: number): boolean {
    return effect.startsAtMs <= atMs && atMs < effect.endsAtMs;
  }

  /** Exact overlap integration makes special duration independent of timer chunk sizes. */
  private raiderMultiplier(effects: readonly SpecialEffect[], start: number, end: number): number {
    const modifiers = effects.filter((effect) => effect.id === 'ram' || effect.id === 'oil');
    const boundaries = new Set([start, end]);
    for (const effect of modifiers) {
      if (effect.startsAtMs > start && effect.startsAtMs < end) boundaries.add(effect.startsAtMs);
      if (effect.endsAtMs > start && effect.endsAtMs < end) boundaries.add(effect.endsAtMs);
    }
    const points = [...boundaries].sort((left, right) => left - right);
    let weightedDuration = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index] ?? start;
      const to = points[index + 1] ?? end;
      const ram = modifiers.some((effect) => effect.id === 'ram' && this.active(effect, from));
      const oil = modifiers.some((effect) => effect.id === 'oil' && this.active(effect, from));
      weightedDuration += (to - from) * (ram ? 2 : 1) * (oil ? 0.5 : 1);
    }
    return weightedDuration / (end - start);
  }
}
