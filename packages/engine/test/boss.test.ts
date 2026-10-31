import { describe, expect, it } from 'vitest';
import { BossRound } from '../src/rounds/boss.js';
import { context as seededContext, input } from './fixture.js';
import type { MatchContext } from '../src/model.js';

const context = (overrides: Partial<MatchContext> = {}): MatchContext => ({
  ...seededContext(overrides),
  rng: () => 0,
});

const round = new BossRound();
const ctx = context({ teams: { home: 1, raiders: 1 }, rng: () => 0 });

describe('Fusion Boss module', () => {
  it('starts a shared boss with a fixed 60 second round and participant-scaled HP', () => {
    const state = round.start(ctx);
    expect(round.durationMs).toBe(60_000);
    expect(round.view(state).boss).toMatchObject({
      hp: 48,
      maxHp: 48,
      weakPoint: 'SPARK',
      weakPointActive: true,
    });
    const active = round.start(context({ activeTeams: { home: 15, raiders: 15 } }));
    expect(round.view(active).boss?.maxHp).toBe(720);
  });

  it('counts base hits and triples only the current weak keyword', () => {
    const initial = round.start(ctx);
    const hit = round.onInput(initial, input(0, { kind: 'hit', value: '!hit' }), ctx);
    expect(round.view(hit).boss?.hp).toBe(47);
    const weak = round.onInput(hit, input(2000, { kind: 'keyword', value: 'SPARK' }), ctx);
    expect(round.view(weak).boss?.hp).toBe(44);
    expect(round.onInput(weak, input(3000, { value: 'SPARK' }), ctx)).toBe(weak);
    expect(round.onInput(weak, input(3000, { kind: 'answer', value: 'A' }), ctx)).toBe(weak);
    expect(round.onInput(weak, input(3000, { kind: 'hit', value: '!notahit' }), ctx)).toBe(weak);
  });

  it.each([
    [0, 'SPARK', true, 3000],
    [2999, 'SPARK', true, 1],
    [3000, 'SPARK', false, 0],
    [9999, 'SPARK', false, 0],
    [10000, 'BLOOM', true, 3000],
    [12999, 'BLOOM', true, 1],
    [13000, 'BLOOM', false, 0],
    [20000, 'SPARK', true, 3000],
    [60000, 'BLOOM', false, 0],
  ])('resolves weak-point boundary at %dms', (atMs, weakPoint, active, remaining) => {
    const state = round.tick(round.start(ctx), Number(atMs), ctx);
    expect(round.view(state).boss).toMatchObject({
      weakPoint,
      weakPointActive: active,
      weakPointRemainingMs: remaining,
    });
  });

  it('rejects late, past, zero-weight and nonfinite input without counting it', () => {
    const state = round.tick(round.start(ctx), 5000, ctx);
    expect(round.onInput(state, input(4000, { kind: 'hit', value: '!hit' }), ctx)).toBe(state);
    expect(round.onInput(state, input(60_000, { kind: 'hit', value: '!hit' }), ctx)).toBe(state);
    expect(round.onInput(state, input(Number.NaN, { kind: 'hit', value: '!hit' }), ctx)).toBe(
      state,
    );
    expect(round.onInput(state, input(5000, { kind: 'hit', value: '!hit', weight: 0 }), ctx)).toBe(
      state,
    );
  });

  it('uses round-local timing when the round starts after earlier rounds', () => {
    const later = context({ ...ctx, nowMs: 110_000 });
    const state = round.start(later);
    const hit = round.onInput(state, input(110_000, { kind: 'keyword', value: 'SPARK' }), later);
    expect(round.view(hit).boss?.hp).toBe(45);
    expect(round.onInput(state, input(1000, { kind: 'hit', value: '!hit' }), later)).toBe(state);
  });

  it('preserves original state and isolates new round instances', () => {
    const initial = round.start(ctx);
    const before = structuredClone(initial);
    const changed = round.onInput(
      initial,
      input(0, { kind: 'hit', value: '!hit', displayName: 'Guard' }),
      ctx,
    );
    expect(changed).not.toBe(initial);
    expect(initial).toEqual(before);
    expect(round.start(ctx)).toEqual(initial);
    expect(round.result(initial).mvps.home).toEqual([]);
  });

  it('caps a reinforcement weight at two and never applies invalid ticks', () => {
    const initial = round.start(ctx);
    const weighted = round.onInput(
      initial,
      input(0, { kind: 'hit', value: '!hit', weight: 100 }),
      ctx,
    );
    expect(round.view(weighted).boss?.hp).toBe(46);
    expect(round.tick(initial, Number.NaN, ctx)).toBe(initial);
    expect(round.tick(initial, Number.POSITIVE_INFINITY, ctx)).toBe(initial);
    expect(round.tick(initial, -1, ctx)).toBe(initial);
    expect(round.view(round.tick(initial, 90_000, ctx)).remainingMs).toBe(0);
  });

  it('provides deterministic static fallbacks for an empty content pack', () => {
    const empty = context({
      ...ctx,
      content: { ...ctx.content, weakPoints: [], boss: { name: '', flavour: '' } },
    });
    expect(round.view(round.start(empty)).boss).toMatchObject({
      name: 'Fusion Guardian',
      weakPoint: 'UNITE',
    });
  });
});
