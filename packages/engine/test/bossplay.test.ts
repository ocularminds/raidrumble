import { describe, expect, it } from 'vitest';
import { BossRound } from '../src/rounds/boss.js';
import type { MatchContext, Team } from '../src/model.js';
import { context as seededContext, input } from './fixture.js';

const context = (overrides: Partial<MatchContext> = {}): MatchContext => ({
  ...seededContext(overrides),
  rng: () => 0,
});

const round = new BossRound();

describe('Fusion Boss fairness and results', () => {
  function play(teamSize: number) {
    const ctx = context({ teams: { home: teamSize, raiders: teamSize }, rng: () => 0 });
    let state = round.start(ctx);
    for (let atMs = 0; atMs < 60_000; atMs += 2000) {
      state = round.tick(state, atMs - round.view(state).elapsedMs, ctx);
      for (const team of ['home', 'raiders'] as Team[]) {
        for (let user = 0; user < teamSize; user++) {
          state = round.onInput(
            state,
            input(atMs, { userId: `${team}${user}`, team, kind: 'hit', value: '!hit' }),
            ctx,
          );
        }
      }
    }
    return { result: round.result(state), view: round.view(state) };
  }

  it('gives small and large equally active groups the same ability to win', () => {
    const small = play(1);
    const large = play(100);
    expect(small.result.winner).toBe('both');
    expect(large.result.winner).toBe('both');
    expect(small.result.stats.defeatedAtMs).toBe(large.result.stats.defeatedAtMs);
    expect(large.result.stats.maxHp).toBe(small.result.stats.maxHp! * 100);
  });

  it('ends in a shared loss when time expires with HP remaining', () => {
    const ctx = context();
    const state = round.tick(round.start(ctx), 60_000, ctx);
    expect(round.result(state).winner).toBe('none');
    expect(round.view(state).phase).toBe('finished');
    expect(round.onInput(state, input(60_000, { kind: 'hit', value: '!hit' }), ctx)).toBe(state);
  });

  it('attributes only actual last-hit damage and ignores further hits', () => {
    const ctx = context({ teams: { home: 1, raiders: 0 }, rng: () => 0 });
    let state = round.start(ctx);
    for (let i = 0; i < 23; i++) {
      state = round.onInput(
        state,
        input(0, { userId: `home${i}`, kind: 'hit', value: '!hit' }),
        ctx,
      );
    }
    state = round.onInput(
      state,
      input(0, { userId: 'last', team: 'raiders', value: 'SPARK', displayName: 'Warlord' }),
      ctx,
    );
    const result = round.result(state);
    expect(result.winner).toBe('both');
    expect(result.mvps.raiders[0]).toEqual({
      userId: 'last',
      contribution: 1,
      displayName: 'Warlord',
    });
    expect(round.view(state).boss?.hp).toBe(0);
    expect(result.stats.homeDamage! + result.stats.raiderDamage!).toBe(24);
    expect(round.onInput(state, input(2000, { kind: 'hit', value: '!hit' }), ctx)).toBe(state);
  });

  it('returns three deterministic MVPs per team', () => {
    const ctx = context({ rng: () => 0 });
    let state = round.start(ctx);
    for (const team of ['home', 'raiders'] as Team[]) {
      for (const userId of ['z', 'c', 'b', 'a']) {
        state = round.onInput(state, input(0, { userId, team, kind: 'hit', value: '!hit' }), ctx);
      }
    }
    expect(round.result(state).mvps.home.map((mvp) => mvp.userId)).toEqual(['a', 'b', 'c']);
    expect(round.result(state).mvps.raiders.map((mvp) => mvp.userId)).toEqual(['a', 'b', 'c']);
  });

  it('produces the same state, views and result for the same seed and inputs', () => {
    expect(play(5)).toEqual(play(5));
  });

  it('projects the full view at a fixed tick', () => {
    const ctx = context({ teams: { home: 1, raiders: 1 }, rng: () => 0 });
    expect(round.view(round.tick(round.start(ctx), 5000, ctx))).toMatchInlineSnapshot(`
      {
        "boss": {
          "flavour": "Two communities, one challenge.",
          "hp": 48,
          "maxHp": 48,
          "name": "The Garden Guardian",
          "weakPoint": "SPARK",
          "weakPointActive": false,
          "weakPointRemainingMs": 0,
        },
        "durationMs": 60000,
        "elapsedMs": 5000,
        "id": "fusion-boss",
        "instruction": "Both teams: type !hit to damage the boss",
        "keyword": "!hit",
        "mvps": {
          "home": [],
          "raiders": [],
        },
        "phase": "active",
        "progress": 0,
        "remainingMs": 55000,
        "scores": {
          "home": 0,
          "raiders": 0,
        },
        "title": "Fusion Boss",
      }
    `);
  });
});
