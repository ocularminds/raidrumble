import type {
  MatchContext,
  PlayerInput,
  RoundModule,
  RoundResult,
  RoundView,
} from '../src/model.js';
import { createContext } from '../src/random.js';

export function context(overrides: Partial<MatchContext> = {}): MatchContext {
  return createContext({
    matchId: 'match',
    seed: 42,
    nowMs: 0,
    teams: { home: 20, raiders: 300 },
    content: {
      siegeKeywords: ['PUSH', 'HOLD'],
      weakPoints: ['SPARK', 'BLOOM'],
      boss: { name: 'The Garden Guardian', flavour: 'Two communities, one challenge.' },
      questions: [],
    },
    ...overrides,
  });
}

export interface TestRoundState {
  readonly elapsedMs: number;
  readonly inputs: number;
}

export class TestRound implements RoundModule<TestRoundState> {
  constructor(
    readonly id: string,
    readonly durationMs: number,
  ) {}

  start(): TestRoundState {
    return { elapsedMs: 0, inputs: 0 };
  }

  onInput(state: TestRoundState, input: PlayerInput): TestRoundState {
    return input.value === 'PUSH' ? { ...state, inputs: state.inputs + 1 } : state;
  }

  tick(state: TestRoundState, dtMs: number): TestRoundState {
    return { ...state, elapsedMs: Math.min(this.durationMs, state.elapsedMs + dtMs) };
  }

  view(state: TestRoundState): RoundView {
    return {
      id: this.id,
      title: this.id,
      phase: state.elapsedMs === this.durationMs ? 'finished' : 'active',
      elapsedMs: state.elapsedMs,
      durationMs: this.durationMs,
      remainingMs: this.durationMs - state.elapsedMs,
      keyword: 'PUSH',
      instruction: 'Type PUSH',
      progress: state.elapsedMs / this.durationMs,
      scores: { home: state.inputs, raiders: 0 },
    };
  }

  result(state: TestRoundState): RoundResult {
    return {
      roundId: this.id,
      winner: 'none',
      mvps: { home: [], raiders: [] },
      stats: { inputs: state.inputs },
    };
  }
}

export function input(atMs: number, overrides: Partial<PlayerInput> = {}): PlayerInput {
  return { userId: 'viewer', team: 'home', kind: 'keyword', value: 'PUSH', atMs, ...overrides };
}
