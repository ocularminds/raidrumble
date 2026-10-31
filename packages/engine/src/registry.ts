import { defineRound } from './round.js';
import { SiegeRound } from './rounds/siege.js';
import { QuizRound } from './rounds/quiz.js';
import { BossRound } from './rounds/boss.js';

/** A new round is one module and one registration, with no runner changes. */
export const rounds = [
  defineRound(new SiegeRound()),
  defineRound(new QuizRound()),
  defineRound(new BossRound()),
] as const;
