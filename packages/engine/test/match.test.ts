import { describe, expect, it } from 'vitest';
import { MatchTimeline } from '../src/match.js';
import { defineRound } from '../src/round.js';
import type { MatchContext, PlayerInput } from '../src/model.js';
import type { TestRoundState } from './fixture.js';
import { context, input, TestRound } from './fixture.js';

const timeline = new MatchTimeline([
  defineRound(new TestRound('siege', 60_000)),
  defineRound(new TestRound('know-your-host', 50_000)),
  defineRound(new TestRound('fusion-boss', 60_000)),
]);

describe('immutable match timeline', () => {
  it('runs 60s, 50s, 60s and a 10s end card', () => {
    const initial = timeline.start(context());
    const siege = timeline.tick(initial, 59_999);
    expect(timeline.view(siege).round?.id).toBe('siege');
    const quiz = timeline.tick(siege, 1);
    expect(timeline.view(quiz).round?.id).toBe('know-your-host');
    expect(timeline.view(quiz).round?.elapsedMs).toBe(0);
    const boss = timeline.tick(quiz, 50_000);
    expect(timeline.view(boss).round?.id).toBe('fusion-boss');
    const endcard = timeline.tick(boss, 60_000);
    expect(timeline.view(endcard).status).toBe('endcard');
    expect(timeline.view(endcard).results).toHaveLength(3);
    expect(timeline.view(endcard).remainingMs).toBe(10_000);
    const done = timeline.tick(endcard, 10_000);
    expect(timeline.view(done).status).toBe('finished');
    expect(timeline.view(done).elapsedMs).toBe(180_000);
    expect(timeline.view(initial).elapsedMs).toBe(0);
  });

  it('carries excess dt across boundaries and clamps at the end', () => {
    const state = timeline.tick(timeline.start(context()), 110_250);
    expect(timeline.view(state).round?.id).toBe('fusion-boss');
    expect(timeline.view(state).round?.elapsedMs).toBe(250);
    const finished = timeline.tick(state, 1_000_000);
    expect(timeline.view(finished).elapsedMs).toBe(180_000);
    expect(timeline.tick(finished, 1)).toBe(finished);
  });

  it('is independent of timer chunk sizes and deterministic for the same inputs', () => {
    const run = () => {
      let state = timeline.start(context());
      for (let atMs = 0; atMs < 180_000; atMs += 100) {
        state = timeline.onInput(state, input(atMs)).state;
      }
      return timeline.view(timeline.tick(state, 100));
    };
    expect(run()).toEqual(run());
    const large = timeline.tick(timeline.start(context()), 180_000);
    let small = timeline.start(context());
    for (let index = 0; index < 1_800; index += 1) small = timeline.tick(small, 100);
    expect(timeline.view(small)).toEqual(timeline.view(large));
  });

  it('only consumes rate budget for counted inputs', () => {
    const started = timeline.start(context());
    const ignored = timeline.onInput(started, input(0, { value: 'wrong' }));
    expect(ignored.counted).toBe(false);
    const counted = timeline.onInput(ignored.state, input(0));
    expect(counted.counted).toBe(true);
    expect(timeline.onInput(counted.state, input(1_999)).counted).toBe(false);
    expect(timeline.onInput(counted.state, input(2_000)).counted).toBe(true);
  });

  it('uses updated context for an event at the current clock instant', () => {
    class ContextRound extends TestRound {
      override onInput(
        state: TestRoundState,
        _input: PlayerInput,
        ctx?: MatchContext,
      ): TestRoundState {
        return { ...state, inputs: ctx?.teams.home ?? 0 };
      }
    }
    const match = new MatchTimeline([defineRound(new ContextRound('context', 1_000))]);
    const initial = match.start(context());
    const result = match.onInput(initial, input(0), context({ teams: { home: 17, raiders: 21 } }));
    expect(match.view(result.state).round?.scores.home).toBe(17);
  });

  it('routes an input exactly on a round boundary to the new round', () => {
    const state = timeline.onInput(timeline.start(context()), input(60_000));
    expect(state.counted).toBe(true);
    expect(timeline.view(state.state).round?.id).toBe('know-your-host');
    expect(timeline.view(state.state).round?.scores.home).toBe(1);
    expect(timeline.view(state.state).results[0]?.stats.inputs).toBe(0);
  });

  it('refuses inputs after gameplay and out-of-order or invalid timestamps', () => {
    const state = timeline.tick(timeline.start(context()), 10_000);
    for (const atMs of [9_999, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(timeline.onInput(state, input(atMs))).toEqual({ state, counted: false });
    }
    expect(timeline.onInput(state, input(170_000)).counted).toBe(false);
  });

  it('ignores invalid dt without losing the live state', () => {
    const state = timeline.start(context());
    for (const delta of [-1, Number.NaN, Number.POSITIVE_INFINITY, 0]) {
      expect(timeline.tick(state, delta)).toBe(state);
    }
  });

  it('allows a new plug-in by adding only a definition', () => {
    const custom = new MatchTimeline([defineRound(new TestRound('custom', 500))], 100);
    const state = custom.tick(custom.start(context()), 500);
    expect(custom.view(state).status).toBe('endcard');
    expect(custom.view(state).results[0]?.roundId).toBe('custom');
  });

  it('validates an empty registry and duplicate ids', () => {
    expect(() => new MatchTimeline([])).toThrow();
    expect(
      () =>
        new MatchTimeline([
          defineRound(new TestRound('same', 100)),
          defineRound(new TestRound('same', 100)),
        ]),
    ).toThrow();
    expect(() => defineRound(new TestRound('bad', 0))).toThrow();
  });

  it('takes a stable, JSON-serialisable view at a fixed tick', () => {
    const view = timeline.view(timeline.tick(timeline.start(context()), 12_000));
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(view).toMatchInlineSnapshot(`
      {
        "degraded": false,
        "elapsedMs": 12000,
        "matchId": "match",
        "remainingMs": 168000,
        "results": [],
        "round": {
          "durationMs": 60000,
          "elapsedMs": 12000,
          "id": "siege",
          "instruction": "Type PUSH",
          "keyword": "PUSH",
          "phase": "active",
          "progress": 0.2,
          "remainingMs": 48000,
          "scores": {
            "home": 0,
            "raiders": 0,
          },
          "title": "siege",
        },
        "roundCount": 3,
        "roundIndex": 0,
        "status": "playing",
        "teams": {
          "home": 20,
          "raiders": 300,
        },
        "winner": "none",
      }
    `);
  });
});
