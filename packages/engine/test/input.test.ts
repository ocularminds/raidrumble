import { describe, expect, it } from 'vitest';
import { InputParser } from '../src/input.js';
import type { RoundView } from '../src/model.js';
import { TestRound } from './fixture.js';

const parser = new InputParser();
const source = { userId: 'viewer', team: 'home' as const, atMs: 0 };
const round = new TestRound('siege', 60_000);
const view = round.view(round.start());

describe('chat command normalisation', () => {
  it('returns only the recognised keyword, never the original viewer message', () => {
    expect(parser.parse({ ...source, text: ' push ' }, view)).toEqual({
      ...source,
      kind: 'keyword',
      value: 'PUSH',
    });
    expect(parser.parse({ ...source, text: 'PUSH unwanted viewer message' }, view)).toBeUndefined();
    expect(parser.parse({ ...source, text: 'x'.repeat(10_000) }, view)).toBeUndefined();
  });

  it('takes only a single A/B/C letter during a quiz question', () => {
    const quiz: RoundView = {
      ...view,
      quiz: {
        index: 0,
        total: 4,
        prompt: 'A question',
        choices: ['One', 'Two', 'Three'],
        scoringTeam: 'raiders',
      },
    };
    expect(parser.parse({ ...source, text: 'b' }, quiz)?.value).toBe('B');
    expect(parser.parse({ ...source, text: 'b' }, quiz)?.kind).toBe('answer');
    expect(parser.parse({ ...source, text: 'A B C' }, quiz)).toBeUndefined();
    expect(parser.parse({ ...source, text: 'B' }, { ...quiz, phase: 'reveal' })).toBeUndefined();
  });

  it('allows !hit and the active boss weak point only', () => {
    const boss: RoundView = {
      ...view,
      boss: {
        name: 'Boss',
        flavour: 'Together',
        hp: 100,
        maxHp: 100,
        weakPoint: 'SPARK',
        weakPointActive: true,
        weakPointRemainingMs: 1_000,
      },
    };
    expect(parser.parse({ ...source, text: '!HIT' }, boss)?.value).toBe('!hit');
    expect(parser.parse({ ...source, text: 'spark' }, boss)?.kind).toBe('keyword');
    expect(parser.parse({ ...source, text: 'PUSH' }, boss)).toBeUndefined();
    const inactive: RoundView = { ...boss, boss: { ...boss.boss!, weakPointActive: false } };
    expect(parser.parse({ ...source, text: 'SPARK' }, inactive)).toBeUndefined();
  });

  it('ignores input on finished rounds and passes only gated display metadata', () => {
    expect(
      parser.parse({ ...source, text: 'PUSH' }, { ...view, phase: 'finished' }),
    ).toBeUndefined();
    const parsed = parser.parse(
      { ...source, text: 'PUSH', displayName: 'Safe name', weight: 2 },
      view,
    );
    expect(parsed?.displayName).toBe('Safe name');
    expect(parsed?.weight).toBe(2);
    expect(parsed).not.toHaveProperty('text');
  });
});
