import type { MatchContext } from './model.js';

/** Indexed 32-bit integer mixing: no mutable cursor or ambient randomness. */
export class SeededRandom {
  constructor(readonly seed: number) {}

  at(index: number): number {
    let value = (this.seed + Math.imul(index + 1, 0x9e3779b9)) | 0;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return ((value ^ (value >>> 15)) >>> 0) / 0x1_0000_0000;
  }

  fork(namespace: string): SeededRandom {
    let seed = this.seed;
    for (const character of namespace) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
    return new SeededRandom(seed);
  }
}

export function createContext(context: Omit<MatchContext, 'rng'>): MatchContext {
  const random = new SeededRandom(context.seed);
  return { ...context, rng: (index) => random.at(index) };
}
