import { describe, expect, it } from 'vitest';
import { InputLimiter } from '../src/limiter.js';

describe('fixed per-user input windows', () => {
  const limiter = new InputLimiter();

  it('counts 50 messages per second only once in each 2-second window', () => {
    let state = limiter.start();
    let count = 0;
    for (let atMs = 0; atMs < 10_000; atMs += 20) {
      const result = limiter.consume(state, 'spammer', atMs);
      state = result.state;
      if (result.allowed) count += 1;
    }
    expect(count).toBe(5);
  });

  it('allows the boundary of the next window and isolates different users', () => {
    const first = limiter.consume(limiter.start(), 'one', 0);
    expect(limiter.consume(first.state, 'one', 1_999).allowed).toBe(false);
    expect(limiter.consume(first.state, 'two', 1_999).allowed).toBe(true);
    expect(limiter.consume(first.state, 'one', 2_000).allowed).toBe(true);
  });

  it('refuses replayed, nonfinite, and negative timestamps', () => {
    const state = limiter.consume(limiter.start(), 'viewer', 4_000).state;
    for (const atMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(limiter.consume(state, 'viewer', atMs).allowed).toBe(false);
    }
  });

  it('supports a match-relative window origin and keeps previous states immutable', () => {
    const offset = new InputLimiter(2_000, 1_001);
    const initial = offset.start();
    const first = offset.consume(initial, 'viewer', 1_001);
    expect(offset.consume(first.state, 'viewer', 3_000).allowed).toBe(false);
    expect(offset.consume(first.state, 'viewer', 3_001).allowed).toBe(true);
    expect(initial.size).toBe(0);
  });

  it('rejects invalid window configuration', () => {
    expect(() => new InputLimiter(0)).toThrow();
    expect(() => new InputLimiter(Number.NaN)).toThrow();
  });
});
