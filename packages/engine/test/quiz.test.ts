import { describe, expect, it } from 'vitest';
import type { MatchContext, PlayerInput, Question } from '../src/model.js';
import { QuizRound } from '../src/rounds/quiz.js';
import { context } from './fixture.js';

const questions: readonly Question[] = [
  {
    id: 'host1',
    about: 'host',
    prompt: 'What is the host playing?',
    choices: ['Gardening', 'Chess', 'Music'],
    answer: 'A',
    explanation: 'The host is playing Gardening.',
  },
  {
    id: 'raider1',
    about: 'raider',
    prompt: 'What is the raider playing?',
    choices: ['Chess', 'Speedrunning', 'Music'],
    answer: 'B',
    explanation: 'The raider is playing Speedrunning.',
  },
  {
    id: 'host2',
    about: 'host',
    prompt: 'What did the host list as a fact?',
    choices: ['Plants', 'Racing', 'Puzzles'],
    answer: 'A',
  },
  {
    id: 'raider2',
    about: 'raider',
    prompt: 'What did the raider list as a fact?',
    choices: ['Music', 'Racing', 'Art'],
    answer: 'B',
  },
];

function fixture(overrides: Partial<MatchContext> = {}): MatchContext {
  const base = context({ teams: { home: 10, raiders: 20 } });
  return { ...base, content: { ...base.content, questions }, ...overrides };
}

function answer(atMs: number, overrides: Partial<PlayerInput> = {}): PlayerInput {
  return { userId: 'r1', team: 'raiders', kind: 'answer', value: 'A', atMs, ...overrides };
}

describe('QuizRound', () => {
  it('starts a 50-second quiz and hides the answer and correctness until reveal', () => {
    const module = new QuizRound();
    const ctx = fixture();
    const initial = module.start(ctx);
    const state = module.onInput(initial, answer(0), ctx);
    expect(state).not.toBe(initial);
    expect(module.view(state)).toMatchObject({
      id: 'know-your-host',
      durationMs: 50_000,
      phase: 'active',
      scores: { home: 0, raiders: 0 },
      quiz: { index: 0, total: 4, scoringTeam: 'raiders' },
    });
    expect(module.view(state).quiz).not.toHaveProperty('answer');
    expect(module.view(state).quiz).not.toHaveProperty('explanation');
    expect(module.view(state).mvps).toBeUndefined();
  });

  it('counts only the first answer, including an incorrect one, for each user/question', () => {
    const module = new QuizRound();
    const ctx = fixture();
    const initial = module.start(ctx);
    const wrong = module.onInput(initial, answer(0, { value: 'C' }), ctx);
    expect(wrong).not.toBe(initial);
    expect(module.onInput(wrong, answer(0), ctx)).toBe(wrong);
    expect(module.result(wrong).stats.raidersCorrect).toBe(0);
    expect(module.result(wrong).stats.raidersAnswers).toBe(1);
  });

  it('ignores the other side and unrecognized commands without counting them', () => {
    const module = new QuizRound();
    const ctx = fixture();
    const state = module.start(ctx);
    for (const input of [
      answer(0, { team: 'home' }),
      answer(0, { value: 'A B C' }),
      answer(0, { value: 'a' }),
      answer(0, { kind: 'keyword' }),
      answer(0, { userId: '' }),
    ]) {
      expect(module.onInput(state, input, ctx)).toBe(state);
    }
  });

  it('freezes correct answer scoring at the ten-second boundary', () => {
    const module = new QuizRound();
    const ctx = fixture();
    let state = module.start(ctx);
    state = module.tick(state, 9999, { ...ctx, nowMs: 9999 });
    state = module.onInput(state, answer(9999), { ...ctx, nowMs: 9999 });
    expect(module.view(state).quiz).not.toHaveProperty('answer');
    state = module.tick(state, 1, { ...ctx, nowMs: 10_000 });
    expect(module.view(state)).toMatchObject({
      phase: 'reveal',
      scores: { home: 0, raiders: 0.05 },
      quiz: { answer: 'A' },
    });
    expect(
      module.onInput(state, answer(10_000, { userId: 'late' }), { ...ctx, nowMs: 10_000 }),
    ).toBe(state);
  });

  it('starts the next question exactly after its 2.5-second reveal', () => {
    const module = new QuizRound();
    const ctx = fixture();
    const state = module.tick(module.start(ctx), 12_500, { ...ctx, nowMs: 12_500 });
    expect(module.view(state)).toMatchObject({
      phase: 'active',
      quiz: { index: 1, scoringTeam: 'home', prompt: questions[1]!.prompt },
    });
    const counted = module.onInput(state, answer(12_500, { team: 'home', value: 'B' }), {
      ...ctx,
      nowMs: 12_500,
    });
    expect(module.result(counted).stats.homeScore).toBeCloseTo(0.1);
    expect(module.result(counted).stats.raidersScore).toBe(0);
  });

  it('allows a user to answer a later question without carrying the earlier lock', () => {
    const module = new QuizRound();
    const ctx = fixture();
    let state = module.onInput(module.start(ctx), answer(0), ctx);
    state = module.tick(state, 25_000, { ...ctx, nowMs: 25_000 });
    const next = module.onInput(state, answer(25_000), { ...ctx, nowMs: 25_000 });
    expect(next).not.toBe(state);
    expect(module.result(next).stats.raidersCorrect).toBe(2);
  });

  it('normalizes by eligible team size with floor five and ignores Siege weights', () => {
    const module = new QuizRound();
    const ctx = fixture({ teams: { home: 1, raiders: 1 } });
    const state = module.onInput(module.start(ctx), answer(0, { weight: 2 }), ctx);
    expect(module.result(state).stats.raidersScore).toBeCloseTo(0.2);
  });

  it('rejects stale, future and finished inputs with unchanged state identity', () => {
    const module = new QuizRound();
    const ctx = fixture({ nowMs: 60_000 });
    const start = module.start(ctx);
    expect(module.onInput(start, answer(59_999), ctx)).toBe(start);
    expect(module.onInput(start, answer(60_001), ctx)).toBe(start);
    const done = module.tick(start, 100_000, { ...ctx, nowMs: 160_000 });
    expect(module.view(done)).toMatchObject({
      elapsedMs: 50_000,
      remainingMs: 0,
      phase: 'finished',
      quiz: { index: 3 },
    });
    expect(module.onInput(done, answer(110_000), { ...ctx, nowMs: 110_000 })).toBe(done);
    expect(module.tick(done, 10, { ...ctx, nowMs: 110_010 })).toBe(done);
  });

  it('safely ignores invalid tick lengths', () => {
    const module = new QuizRound();
    const ctx = fixture();
    const state = module.start(ctx);
    for (const dt of [-10, 0, Number.NaN, Number.POSITIVE_INFINITY])
      expect(module.tick(state, dt, ctx)).toBe(state);
  });

  it('fills missing sides from authored game rules and does not invent streamer facts', () => {
    const module = new QuizRound();
    const base = fixture();
    const state = module.start({
      ...base,
      content: { ...base.content, questions: [questions[0]!] },
    });
    expect(module.view(state).quiz?.prompt).toBe(questions[0]!.prompt);
    const second = module.tick(state, 12_500, { ...base, nowMs: 12_500 });
    expect(module.view(second).quiz?.prompt).toBe('Which team arrives with the raiding streamer?');
    expect(module.view(second).quiz?.scoringTeam).toBe('home');
  });

  it('keeps caller state and content immutable across inputs and ticks', () => {
    const module = new QuizRound();
    const ctx = fixture();
    const state = module.start(ctx);
    const before = JSON.stringify(state);
    Object.freeze(state);
    const counted = module.onInput(state, answer(0), ctx);
    module.tick(counted, 10_000, { ...ctx, nowMs: 10_000 });
    expect(JSON.stringify(state)).toBe(before);
    expect(ctx.content.questions).toEqual(questions);
  });
});
