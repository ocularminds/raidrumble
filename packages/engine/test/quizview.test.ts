import { describe, expect, it } from 'vitest';
import type { MatchContext, Question, Team } from '../src/model.js';
import { QuizRound } from '../src/rounds/quiz.js';
import { context } from './fixture.js';

const questions: readonly Question[] = [
  {
    id: 'h1',
    about: 'host',
    prompt: 'Host category?',
    choices: ['Gardening', 'Chess', 'Art'],
    answer: 'A',
    explanation: 'Gardening.',
  },
  {
    id: 'r1',
    about: 'raider',
    prompt: 'Raider category?',
    choices: ['Art', 'Speedrunning', 'Chess'],
    answer: 'B',
  },
  {
    id: 'h2',
    about: 'host',
    prompt: 'Host fact?',
    choices: ['A fact', 'Another fact', 'Third fact'],
    answer: 'A',
  },
  {
    id: 'r2',
    about: 'raider',
    prompt: 'Raider fact?',
    choices: ['A fact', 'Another fact', 'Third fact'],
    answer: 'B',
  },
];

function fixture(): MatchContext {
  const ctx = context({ teams: { home: 15, raiders: 300 } });
  return { ...ctx, content: { ...ctx.content, questions } };
}

function play(module: QuizRound, ctx: MatchContext) {
  let state = module.start(ctx);
  for (let index = 0; index < 4; index++) {
    const atMs = index * 12_500;
    const team: Team = index % 2 === 0 ? 'raiders' : 'home';
    const size = team === 'home' ? 15 : 300;
    for (let viewer = 0; viewer < size; viewer++) {
      state = module.onInput(
        state,
        {
          userId: `${team}${viewer}`,
          team,
          kind: 'answer',
          value: index % 2 === 0 ? 'A' : 'B',
          atMs,
          displayName: `Player ${viewer}`,
        },
        { ...ctx, nowMs: atMs },
      );
    }
    state = module.tick(state, 12_500, { ...ctx, nowMs: atMs + 12_500 });
  }
  return state;
}

describe('QuizRound presentation and determinism', () => {
  it('gives equally engaged teams an equal normalized result despite different sizes', () => {
    const module = new QuizRound();
    const result = module.result(play(module, fixture()));
    expect(result.stats.homeScore).toBeCloseTo(2, 10);
    expect(result.stats.raidersScore).toBeCloseTo(2, 10);
    expect(result.winner).toBe('none');
  });

  it('returns identical views and results for the same seed, content, and inputs', () => {
    const first = new QuizRound();
    const second = new QuizRound();
    const firstState = play(first, fixture());
    const secondState = play(second, fixture());
    expect(first.view(firstState)).toEqual(second.view(secondState));
    expect(first.result(firstState)).toEqual(second.result(secondState));
  });

  it('returns at most three MVPs per team with stable ties and gated names', () => {
    const module = new QuizRound();
    const result = module.result(play(module, fixture()));
    expect(result.mvps.home).toHaveLength(3);
    expect(result.mvps.raiders).toHaveLength(3);
    expect(result.mvps.home[0]).toEqual({
      userId: 'home0',
      displayName: 'Player 0',
      contribution: 2,
    });
    expect(result.mvps.home[1]?.userId).toBe('home1');
  });

  it('renders a fixed reveal snapshot without displaying viewer input', () => {
    const module = new QuizRound();
    const ctx = fixture();
    const state = module.tick(module.start(ctx), 10_000, { ...ctx, nowMs: 10_000 });
    expect(module.view(state)).toMatchInlineSnapshot(`
      {
        "durationMs": 50000,
        "elapsedMs": 10000,
        "id": "know-your-host",
        "instruction": "Gardening.",
        "keyword": "ANSWER: A",
        "phase": "reveal",
        "progress": 0.2,
        "quiz": {
          "answer": "A",
          "choices": [
            "Gardening",
            "Chess",
            "Art",
          ],
          "explanation": "Gardening.",
          "index": 0,
          "prompt": "Host category?",
          "scoringTeam": "raiders",
          "total": 4,
        },
        "remainingMs": 40000,
        "scores": {
          "home": 0,
          "raiders": 0,
        },
        "title": "Know Your Host",
      }
    `);
  });
});
