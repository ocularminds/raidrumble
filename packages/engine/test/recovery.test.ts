import { describe, expect, it } from 'vitest';
import { MatchTimeline } from '../src/match.js';
import { defineRound } from '../src/round.js';
import { context, input, TestRound } from './fixture.js';

describe('failed round isolation', () => {
  it.each(['start', 'tick', 'onInput', 'view', 'result'] as const)(
    'keeps the timer and next round alive when %s throws',
    (method) => {
      const broken = new TestRound('broken', 100);
      Object.defineProperty(broken, method, {
        value: () => {
          throw new Error('round failed');
        },
      });
      const timeline = new MatchTimeline(
        [defineRound(broken), defineRound(new TestRound('healthy', 100))],
        50,
      );
      let state = timeline.start(context());
      state = timeline.onInput(state, input(1)).state;
      state = timeline.tick(state, 1);
      const duringFailure = timeline.view(state);
      if (method !== 'result') expect(duringFailure.degraded).toBe(true);
      state = timeline.tick(state, 248);
      expect(timeline.view(state).status).toBe('finished');
      expect(timeline.view(state).results.map((result) => result.roundId)).toEqual([
        'broken',
        'healthy',
      ]);
    },
  );
});
