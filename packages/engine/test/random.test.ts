import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../src/random.js';

describe('indexed seeded randomness', () => {
  it('repeats the same sequence independent of call order', () => {
    const first = new SeededRandom(123);
    const second = new SeededRandom(123);
    const values = Array.from({ length: 100 }, (_, index) => first.at(index));
    expect(values).toEqual(Array.from({ length: 100 }, (_, index) => second.at(index)));
    expect(first.at(3)).toBe(values[3]);
    expect(new Set(values).size).toBe(100);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('changes with the seed and supports a stable namespaced fork', () => {
    expect(new SeededRandom(12).at(0)).not.toBe(new SeededRandom(13).at(0));
    const random = new SeededRandom(12);
    expect(random.fork('siege').at(2)).toBe(random.fork('siege').at(2));
    expect(random.fork('siege').at(2)).not.toBe(random.fork('boss').at(2));
  });
});
