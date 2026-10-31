import { describe, expect, it } from 'vitest';
import { SiegeRound } from '../src/rounds/siege.js';
import type { MatchContext, PlayerInput, SpecialEffect, TeamValues } from '../src/model.js';
import { MatchTimeline } from '../src/match.js';
import { defineRound } from '../src/round.js';
import { context } from './fixture.js';

const round = new SiegeRound();
const ctx = (overrides: Partial<MatchContext> = {}): MatchContext => ({
  ...context(),
  teams: { home: 15, raiders: 300 },
  rng: () => 0,
  ...overrides,
});

function move(atMs: number, value: string, overrides: Partial<PlayerInput> = {}): PlayerInput {
  return { userId: 'viewer', team: 'home', kind: 'keyword', value, atMs, ...overrides };
}

function run(
  teams: TeamValues,
  active: TeamValues,
  specials: readonly SpecialEffect[] = [],
  chunkMs = 2_000,
) {
  const initial = ctx({ teams, specials });
  let state = round.start(initial);
  for (let atMs = 0; atMs < round.durationMs; atMs += 2_000) {
    const keyword = round.view(state).keyword;
    for (const team of ['home', 'raiders'] as const) {
      for (let index = 0; index < active[team]; index += 1) {
        state = round.onInput(
          state,
          move(atMs, keyword, {
            team,
            userId: `${team}${index}`,
            displayName: `${team} ${index}`,
          }),
          { ...initial, nowMs: atMs },
        );
      }
    }
    for (let delta = 0; delta < 2_000; delta += chunkMs) {
      state = round.tick(state, Math.min(chunkMs, 2_000 - delta), {
        ...initial,
        nowMs: atMs + Math.min(delta + chunkMs, 2_000),
      });
    }
  }
  return { state, result: round.result(state), view: round.view(state) };
}

describe('Siege participation fairness', () => {
  it('lets 15 engaged home viewers beat 300 raiders with 5% participation', () => {
    const { result, view } = run({ home: 15, raiders: 300 }, { home: 15, raiders: 15 });
    expect(result.winner).toBe('home');
    expect(result.stats.homeParticipation).toBeCloseTo(1);
    expect(result.stats.raiderParticipation).toBeCloseTo(0.05);
    expect(view.gate?.position).toBeCloseTo(0.025);
  });

  it.each([
    [
      { home: 20, raiders: 300 },
      { home: 1, raiders: 15 },
    ],
    [
      { home: 15, raiders: 300 },
      { home: 15, raiders: 300 },
    ],
    [
      { home: 100, raiders: 20 },
      { home: 50, raiders: 10 },
    ],
  ])('keeps equal participation rates within 5% of a draw', (teams, active) => {
    const { result, view } = run(teams, active);
    expect(result.winner).toBe('none');
    expect(Math.abs((view.gate?.position ?? 0) - 0.5)).toBeLessThanOrEqual(0.05);
    expect(view.scores.home).toBeCloseTo(view.scores.raiders);
  });

  it('uses a denominator floor of five for very small communities', () => {
    const { result } = run({ home: 2, raiders: 5 }, { home: 2, raiders: 2 });
    expect(result.winner).toBe('none');
    expect(result.stats.homeParticipation).toBeCloseTo(0.4);
    expect(result.stats.raiderParticipation).toBeCloseTo(0.4);
  });

  it('scores eligible team sizes rather than only the observed active subset', () => {
    const initial = ctx({ activeTeams: { home: 15, raiders: 15 } });
    let state = round.start(initial);
    state = round.onInput(state, move(0, round.view(state).keyword, { team: 'raiders' }), initial);
    state = round.tick(state, 2_000, { ...initial, nowMs: 2_000 });
    expect(round.view(state).gate?.force.raiders).toBeCloseTo(1 / 300);
  });

  it('freezes team denominators until the next input window', () => {
    const initial = ctx({ teams: { home: 10, raiders: 10 } });
    let state = round.start(initial);
    state = round.onInput(state, move(0, round.view(state).keyword), initial);
    const enlarged = { ...initial, nowMs: 2_000, teams: { home: 100, raiders: 100 } };
    state = round.tick(state, 2_000, enlarged);
    expect(round.view(state).gate?.force.home).toBeCloseTo(0.1);
    state = round.onInput(state, move(2_000, round.view(state).keyword), enlarged);
    state = round.tick(state, 2_000, { ...enlarged, nowMs: 4_000 });
    expect(round.view(state).gate?.force.home).toBeCloseTo(0.01);
  });

  it('keeps gate position inside the arena under extreme authorised weight', () => {
    expect(run({ home: 5, raiders: 5 }, { home: 100, raiders: 0 }).view.gate?.position).toBe(0);
    expect(run({ home: 5, raiders: 5 }, { home: 0, raiders: 100 }).view.gate?.position).toBe(1);
  });
});

describe('Siege lifecycle and inputs', () => {
  it('lasts 60 seconds and rotates the keyword every 10 seconds', () => {
    const initial = ctx();
    const first = round.start(initial);
    const keyword = round.view(first).keyword;
    const before = round.tick(first, 9_999, { ...initial, nowMs: 9_999 });
    expect(round.view(before).keyword).toBe(keyword);
    const changed = round.tick(before, 1, { ...initial, nowMs: 10_000 });
    expect(round.view(changed).keyword).not.toBe(keyword);
    expect(round.onInput(changed, move(10_000, keyword), initial)).toBe(changed);
    const final = round.tick(changed, 100_000, { ...initial, nowMs: 110_000 });
    expect(round.view(final).remainingMs).toBe(0);
    expect(round.view(final).elapsedMs).toBe(60_000);
    expect(round.view(final).phase).toBe('finished');
  });

  it('returns identical state for ignored, invalid, or expired inputs', () => {
    const initial = ctx();
    const state = round.start(initial);
    const keyword = round.view(state).keyword;
    for (const input of [
      move(0, 'unrecognised viewer message'),
      move(0, keyword, { kind: 'answer' }),
      move(-1, keyword),
      move(60_000, keyword),
      move(Number.NaN, keyword),
    ])
      expect(round.onInput(state, input, initial)).toBe(state);
    const final = round.tick(state, 60_000, { ...initial, nowMs: 60_000 });
    expect(round.onInput(final, move(60_000, keyword), initial)).toBe(final);
  });

  it('uses the shared limiter to count a 50-message/second spammer once per 2 seconds', () => {
    const timeline = new MatchTimeline([defineRound(round)]);
    let state = timeline.start(ctx());
    let counted = 0;
    for (let atMs = 0; atMs < 60_000; atMs += 20) {
      state = timeline.tick(state, atMs - state.context.nowMs);
      const keyword = timeline.view(state).round?.keyword ?? '';
      const input = timeline.onInput(state, move(atMs, keyword));
      state = input.state;
      if (input.counted) counted += 1;
    }
    expect(counted).toBe(30);
  });

  it('keeps all earlier states unchanged and produces stable top-three MVPs per team', () => {
    const initial = ctx();
    const state = round.start(initial);
    const before = round.view(state);
    round.onInput(state, move(0, before.keyword), initial);
    expect(round.view(state)).toEqual(before);
    const { result } = run({ home: 5, raiders: 5 }, { home: 5, raiders: 5 });
    expect(result.mvps.home.map((mvp) => mvp.userId)).toEqual(['home0', 'home1', 'home2']);
    expect(result.mvps.raiders.map((mvp) => mvp.userId)).toEqual([
      'raiders0',
      'raiders1',
      'raiders2',
    ]);
    expect(result.mvps.home[0]?.contribution).toBe(30);
    expect(result.mvps.home[0]?.displayName).toBe('home 0');
  });

  it('is deterministic and invariant under tick partitioning', () => {
    const effects: SpecialEffect[] = [{ id: 'ram', startsAtMs: 5_500, endsAtMs: 10_500 }];
    const large = run({ home: 15, raiders: 300 }, { home: 15, raiders: 15 }, effects, 2_000);
    const small = run({ home: 15, raiders: 300 }, { home: 15, raiders: 15 }, effects, 100);
    expect(small.view).toEqual(large.view);
    expect(small.result).toEqual(large.result);
    expect(run({ home: 15, raiders: 300 }, { home: 15, raiders: 15 }, effects).result).toEqual(
      large.result,
    );
  });

  it('uses the injected seed without sharing mutable randomness between instances', () => {
    const first = ctx(context({ seed: 123 }));
    const second = ctx(context({ seed: 123 }));
    const before = round.view(round.start(first));
    round.start(ctx(context({ seed: 456 })));
    expect(new SiegeRound().view(new SiegeRound().start(second))).toEqual(before);
    const keywords = new Set(
      Array.from({ length: 20 }, (_, seed) => round.view(round.start(context({ seed }))).keyword),
    );
    expect(keywords.size).toBeGreaterThan(1);
  });

  it('ignores invalid ticks and has a keyword when the content list is empty', () => {
    const initial = ctx();
    const state = round.start({ ...initial, content: { ...initial.content, siegeKeywords: [] } });
    expect(round.view(state).keyword).toBeTruthy();
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(round.tick(state, dt, initial)).toBe(state);
    }
  });

  it('projects a stable, serialisable view at a fixed tick', () => {
    const initial = ctx({ rng: () => 0 });
    const view = round.view(
      round.tick(round.start(initial), 12_000, { ...initial, nowMs: 12_000 }),
    );
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(view).toMatchInlineSnapshot(`
      {
        "durationMs": 60000,
        "elapsedMs": 12000,
        "gate": {
          "force": {
            "home": 0,
            "raiders": 0,
          },
          "position": 0.5,
        },
        "id": "siege",
        "instruction": "Type HOLD · one move every 2 seconds",
        "keyword": "HOLD",
        "mvps": {
          "home": [],
          "raiders": [],
        },
        "phase": "active",
        "progress": 0.5,
        "remainingMs": 48000,
        "scores": {
          "home": 0,
          "raiders": 0,
        },
        "title": "Siege",
      }
    `);
  });
});

describe('authorised Siege modifiers', () => {
  const teams = { home: 5, raiders: 5 };

  it('applies a ram for exactly 5 seconds even across scoring-window boundaries', () => {
    const { result } = run(teams, teams, [{ id: 'ram', startsAtMs: 5_500, endsAtMs: 10_500 }]);
    expect(result.stats.raiderParticipation).toBeCloseTo(1 + 5 / 60);
  });

  it('applies oil at minus 50% for exactly 5 seconds', () => {
    const { result } = run(teams, teams, [{ id: 'oil', startsAtMs: 5_500, endsAtMs: 10_500 }]);
    expect(result.stats.raiderParticipation).toBeCloseTo(1 - 2.5 / 60);
  });

  it('cancels simultaneous ram and oil without multiplying duplicate entries', () => {
    const ram: SpecialEffect = { id: 'ram', startsAtMs: 5_500, endsAtMs: 10_500 };
    const oil: SpecialEffect = { id: 'oil', startsAtMs: 5_500, endsAtMs: 10_500 };
    const { result } = run(teams, teams, [ram, ram, oil, oil]);
    expect(result.stats.raiderParticipation).toBeCloseTo(1);
    expect(result.winner).toBe('none');
  });

  it('integrates partially overlapping ram and oil intervals', () => {
    const { result } = run(teams, teams, [
      { id: 'ram', startsAtMs: 5_500, endsAtMs: 10_500 },
      { id: 'oil', startsAtMs: 7_500, endsAtMs: 12_500 },
    ]);
    expect(result.stats.raiderParticipation).toBeCloseTo(1 + 1 / 60);
  });

  it('caps an oversized special duration and does not replay a spent special', () => {
    const { result } = run(teams, teams, [
      { id: 'ram', startsAtMs: 5_500, endsAtMs: 99_999 },
      { id: 'ram', startsAtMs: 20_000, endsAtMs: 25_000 },
    ]);
    expect(result.stats.raiderParticipation).toBeCloseTo(1 + 5 / 60);
  });

  it('gives reinforcements only to their redeemer for at most 10 seconds', () => {
    const { result } = run(teams, { home: 1, raiders: 1 }, [
      { id: 'reinforcements', userId: 'home0', startsAtMs: 0, endsAtMs: 100_000 },
    ]);
    expect(result.stats.homeParticipation).toBeCloseTo(35 / 150);
    expect(result.stats.raiderParticipation).toBeCloseTo(30 / 150);
  });

  it('caps a provided input weight at two and handles nonfinite weights safely', () => {
    const initial = ctx({ teams });
    let state = round.start(initial);
    state = round.onInput(state, move(0, round.view(state).keyword, { weight: 500 }), initial);
    state = round.tick(state, 2_000, { ...initial, nowMs: 2_000 });
    expect(round.view(state).gate?.force.home).toBeCloseTo(2 / 5);
    state = round.onInput(
      state,
      move(2_000, round.view(state).keyword, { weight: Number.NaN }),
      initial,
    );
    state = round.tick(state, 2_000, { ...initial, nowMs: 4_000 });
    expect(round.view(state).gate?.force.home).toBeCloseTo(1 / 5);
  });
});
