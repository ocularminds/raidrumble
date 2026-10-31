import {
  AttributionEngine,
  Contributors,
  InputParser,
  MatchTimeline,
  rounds,
  type Assignment,
  type AttributionState,
  type ContributorState,
  type MatchContext,
  type MatchState,
  type MatchView,
  type SpecialEffect,
  type Team,
} from '@raidrumble/engine';
import { demoParticipants } from './demo.js';

export interface GameChat {
  userId: string;
  text: string;
  /** Only a name returned by ContentService.name may be supplied. */
  displayName?: string;
  sourceBroadcasterId?: string;
  firstHostMessageAtMs?: number;
  isRegular?: boolean;
}

export interface GameOptions {
  hostId: string;
  raiderId: string;
  context: MatchContext;
  simulated?: boolean;
  collab?: boolean;
  names?: ReadonlyMap<string, string>;
  roster?: ReadonlySet<string>;
  chatterDelta?: ReadonlySet<string>;
  modifiers?: {
    effects(nowMs: number): readonly SpecialEffect[];
    weight(userId: string, nowMs: number): number;
  };
}

/** Runs all registered modules without branching on their IDs. */
export class Game {
  private readonly timeline = new MatchTimeline(rounds);
  private readonly attribution = new AttributionEngine();
  private readonly parser = new InputParser();
  private readonly contributors = new Contributors();
  private feedback?: ContributorState;
  private state: MatchState;
  private assignments: AttributionState = this.attribution.start();
  private nextInputAt = 0;
  private readonly active = { home: new Set<string>(), raiders: new Set<string>() };
  private readonly roster: ReadonlySet<string>;
  readonly raiderLastSeen = new Map<string, number>();

  constructor(private readonly options: GameOptions) {
    this.state = this.timeline.start(options.context);
    this.nextInputAt = options.context.nowMs;
    this.roster =
      options.roster ??
      (options.simulated
        ? new Set(Array.from({ length: 300 }, (_, index) => `raider${index}`))
        : new Set());
  }

  view(): MatchView {
    const view = this.timeline.view(this.state);
    return this.feedback && view.status === 'playing'
      ? { ...view, feedback: this.contributors.view(this.feedback, view.elapsedMs) }
      : view;
  }
  now(): number {
    return this.state.context.nowMs;
  }
  assignment(userId: string): Assignment | undefined {
    return this.assignments.assignments.get(userId);
  }

  step(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    const target = Math.min(this.state.startedAtMs + this.timeline.durationMs, this.now() + dtMs);
    if (this.options.simulated) {
      while (this.nextInputAt <= target && this.state.status === 'playing') {
        this.advance(this.nextInputAt);
        this.synthetic();
        this.nextInputAt += 2000;
      }
    }
    this.advance(target);
  }

  chat(message: GameChat): boolean {
    if (this.state.status !== 'playing') return false;
    const resolved = this.attribution.resolve(this.assignments, {
      userId: message.userId,
      hostId: this.options.hostId,
      raiderId: this.options.raiderId,
      raidAtMs: this.state.startedAtMs,
      roster: this.roster,
      chatterDelta: this.options.chatterDelta,
      sourceBroadcasterId: message.sourceBroadcasterId,
      firstHostMessageAtMs: message.firstHostMessageAtMs,
      isRegular: message.isRegular,
    });
    this.assignments = resolved.state;
    const selection = this.attribution.parseSelection(message.text);
    if (selection) {
      this.assignments = this.attribution.select(this.assignments, message.userId, selection).state;
      return false;
    }
    const team = resolved.assignment.team;
    if (team === 'raiders') this.raiderLastSeen.set(message.userId, this.now());
    const round = this.view().round;
    if (!round) return false;
    const input = this.parser.parse(
      {
        userId: message.userId,
        team,
        atMs: this.now(),
        text: message.text,
        displayName: message.displayName,
        weight: this.options.modifiers?.weight(message.userId, this.now()) ?? 1,
      },
      round,
    );
    if (!input) return false;
    const result = this.timeline.onInput(this.state, input, this.context());
    this.state = result.state;
    if (result.counted) {
      this.assignments = this.attribution.lock(this.assignments, message.userId);
      this.active[team].add(message.userId);
      if (round.gate || round.boss) {
        this.feedback = this.contributors.count(
          this.feedback ?? this.contributors.start(round.id),
          input,
          this.state.elapsedMs,
        );
      }
    }
    return result.counted;
  }

  private context(): MatchContext {
    return {
      ...this.state.context,
      activeTeams: { home: this.active.home.size, raiders: this.active.raiders.size },
      specials: this.options.modifiers?.effects(this.now()) ?? [],
    };
  }

  private advance(atMs: number): void {
    this.state = this.timeline.tick(this.state, Math.max(0, atMs - this.now()), this.context());
    if (this.feedback) {
      this.feedback =
        this.state.status === 'playing' && this.feedback.roundId === this.state.active.id
          ? this.contributors.tick(this.feedback, this.state.elapsedMs)
          : undefined;
    }
  }

  private synthetic(): void {
    const round = this.view().round;
    if (!round || round.phase !== 'active') return;
    for (const team of ['home', 'raiders'] as const) {
      const count = demoParticipants(team, round, Boolean(this.options.collab));
      for (let index = 0; index < count; index++) {
        let text = round.keyword;
        if (round.quiz) {
          const question = this.state.context.content.questions[round.quiz.index];
          text = question?.answer ?? 'A';
          if (index % 5 === 0) text = text === 'A' ? 'B' : 'A';
        } else if (round.boss && !round.boss.weakPointActive) text = '!hit';
        const userId = `${team === 'home' ? 'home' : 'raider'}${index}`;
        this.chat({
          userId,
          text,
          displayName: this.options.names?.get(userId),
          isRegular: team === 'home',
          firstHostMessageAtMs: team === 'home' ? -1 : 1,
          sourceBroadcasterId: this.options.collab ? this.channel(team) : undefined,
        });
      }
    }
  }

  private channel(team: Team): string {
    return team === 'home' ? this.options.hostId : this.options.raiderId;
  }
}
