import type {
  MatchContext,
  Mvp,
  PlayerInput,
  RoundModule,
  RoundResult,
  RoundView,
  Team,
  TeamMvps,
  TeamValues,
} from '../model.js';

export interface BossState {
  readonly startedAtMs: number;
  readonly elapsedMs: number;
  readonly name: string;
  readonly flavour: string;
  readonly weakPoints: readonly string[];
  readonly weakOffset: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly activeParticipants: number;
  readonly damage: TeamValues;
  readonly contributors: Readonly<Record<Team, ReadonlyMap<string, Mvp>>>;
  readonly hits: number;
  readonly weakHits: number;
  readonly defeatedAtMs?: number;
}

interface WeakPoint {
  keyword: string;
  active: boolean;
  remainingMs: number;
}
const participantCount = (count: number) =>
  Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;

/** Both teams share one HP pool; the caller supplies already gated content and limited inputs. */
export class BossRound implements RoundModule<BossState> {
  readonly id = 'fusion-boss';
  readonly durationMs = 60_000;

  start(ctx: MatchContext): BossState {
    const teams = ctx.activeTeams ?? ctx.teams;
    const activeParticipants = participantCount(teams.home) + participantCount(teams.raiders);
    // Twenty-four base inputs per participant makes the boss beatable at equal engagement at any size.
    const maxHp = Math.max(1, activeParticipants) * 24;
    const weakPoints = ctx.content.weakPoints.filter((keyword) => keyword.trim().length > 0);
    const keywords = weakPoints.length ? [...weakPoints] : ['UNITE'];
    const random = ctx.rng(300);
    const weakOffset = Math.floor(
      (Number.isFinite(random) ? Math.max(0, Math.min(random, 0.999999)) : 0) * keywords.length,
    );
    return {
      startedAtMs: ctx.nowMs,
      elapsedMs: 0,
      name: ctx.content.boss.name.trim() || 'Fusion Guardian',
      flavour: ctx.content.boss.flavour.trim() || 'Two communities. One victory.',
      weakPoints: keywords,
      weakOffset,
      hp: maxHp,
      maxHp,
      activeParticipants,
      damage: { home: 0, raiders: 0 },
      contributors: { home: new Map(), raiders: new Map() },
      hits: 0,
      weakHits: 0,
    };
  }

  onInput(state: BossState, input: PlayerInput, _ctx: MatchContext): BossState {
    const elapsedMs = input.atMs - state.startedAtMs;
    if (
      state.hp <= 0 ||
      state.elapsedMs >= this.durationMs ||
      !Number.isFinite(elapsedMs) ||
      elapsedMs < state.elapsedMs ||
      elapsedMs >= this.durationMs ||
      !input.userId ||
      (input.team !== 'home' && input.team !== 'raiders')
    )
      return state;
    const weak = this.weakPoint(state, elapsedMs);
    const value = input.value.toUpperCase();
    const isWeak = input.kind === 'keyword' && weak.active && value === weak.keyword.toUpperCase();
    const isHit = input.kind === 'hit' && value === '!HIT';
    if (!isWeak && !isHit) return state;
    const weight = input.weight ?? 1;
    if (!Number.isFinite(weight) || weight <= 0) return state;
    const damage = Math.min(state.hp, Math.min(2, weight) * (isWeak ? 3 : 1));
    const hp = state.hp - damage;
    const contributors = new Map(state.contributors[input.team]);
    const previous = contributors.get(input.userId);
    contributors.set(input.userId, {
      userId: input.userId,
      contribution: (previous?.contribution ?? 0) + damage,
      ...((input.displayName ?? previous?.displayName) === undefined
        ? {}
        : { displayName: input.displayName ?? previous?.displayName }),
    });
    return {
      ...state,
      elapsedMs,
      hp,
      damage: { ...state.damage, [input.team]: state.damage[input.team] + damage },
      contributors: { ...state.contributors, [input.team]: contributors },
      hits: state.hits + 1,
      weakHits: state.weakHits + (isWeak ? 1 : 0),
      ...(hp === 0 ? { defeatedAtMs: elapsedMs } : {}),
    };
  }

  tick(state: BossState, dtMs: number, _ctx: MatchContext): BossState {
    if (!Number.isFinite(dtMs) || dtMs <= 0 || state.elapsedMs >= this.durationMs) return state;
    return { ...state, elapsedMs: Math.min(this.durationMs, state.elapsedMs + dtMs) };
  }

  view(state: BossState): RoundView {
    const weak = this.weakPoint(state, state.elapsedMs);
    const finished = state.hp <= 0 || state.elapsedMs >= this.durationMs;
    return {
      id: this.id,
      title: 'Fusion Boss',
      phase: finished ? 'finished' : 'active',
      elapsedMs: state.elapsedMs,
      durationMs: this.durationMs,
      remainingMs: this.durationMs - state.elapsedMs,
      keyword: weak.active ? weak.keyword : '!hit',
      instruction:
        state.hp <= 0
          ? 'Both communities win together!'
          : weak.active
            ? `Both teams: type ${weak.keyword} for 3× damage`
            : 'Both teams: type !hit to damage the boss',
      progress: 1 - state.hp / state.maxHp,
      scores: { ...state.damage },
      boss: {
        name: state.name,
        flavour: state.flavour,
        hp: state.hp,
        maxHp: state.maxHp,
        weakPoint: weak.keyword,
        weakPointActive: weak.active,
        weakPointRemainingMs: weak.remainingMs,
      },
      mvps: this.mvps(state),
    };
  }

  result(state: BossState): RoundResult {
    return {
      roundId: this.id,
      winner: state.hp <= 0 ? 'both' : 'none',
      mvps: this.mvps(state),
      stats: {
        hp: state.hp,
        maxHp: state.maxHp,
        activeParticipants: state.activeParticipants,
        homeDamage: state.damage.home,
        raiderDamage: state.damage.raiders,
        hits: state.hits,
        weakHits: state.weakHits,
        defeatedAtMs: state.defeatedAtMs ?? -1,
      },
    };
  }

  private weakPoint(state: BossState, elapsedMs: number): WeakPoint {
    const window = Math.floor(Math.min(elapsedMs, this.durationMs - 1) / 10_000);
    const keyword =
      state.weakPoints[(state.weakOffset + window) % state.weakPoints.length] ?? 'UNITE';
    const active = state.hp > 0 && elapsedMs < this.durationMs && elapsedMs % 10_000 < 3000;
    return { keyword, active, remainingMs: active ? 3000 - (elapsedMs % 10_000) : 0 };
  }

  private mvps(state: BossState): TeamMvps {
    const top = (team: Team): Mvp[] =>
      [...state.contributors[team].values()]
        .sort(
          (left, right) =>
            right.contribution - left.contribution ||
            (left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0),
        )
        .slice(0, 3)
        .map((mvp) => ({ ...mvp }));
    return { home: top('home'), raiders: top('raiders') };
  }
}
