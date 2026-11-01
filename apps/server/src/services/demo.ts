import type { RoundView, Team } from '@raidrumble/engine';

/** Script participation only; the real round scores all inputs without fixture-specific rules. */
export function demoParticipants(team: Team, round: RoundView, collab: boolean): number {
  if (collab) return team === 'home' ? 20 : 15;
  if (round.gate) {
    if (team === 'raiders') return round.elapsedMs < 50_000 ? 15 : 300;
    return round.elapsedMs < 20_000 ? 5 : round.elapsedMs < 50_000 ? 3 : 2;
  }
  // The 300 Raiders who rallied stay for the co-op boss; its HP uses observed participants.
  if (round.boss) return team === 'home' ? 20 : 300;
  return team === 'home' ? 20 : 15;
}
