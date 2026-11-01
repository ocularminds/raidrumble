import type { ArenaView } from '../../server/src/model.js';

export type Cue = 'keyword' | 'gate' | 'weak' | 'gg';

/** Derives transitions from snapshots; repeated network frames never replay a cue. */
export class CueDetector {
  private matchId = '';
  private keyword = '';
  private weak = false;
  private won = false;
  private lastPop = '';
  private lastGateAt = -Infinity;

  update(view: ArenaView): Cue[] {
    const match = view.match;
    const round = match?.round;
    if (!view.sound || view.status !== 'active' || !match || !round) {
      if (!view.sound) this.matchId = '';
      return [];
    }
    if (this.matchId !== match.matchId) {
      this.matchId = match.matchId;
      this.keyword = '';
      this.weak = false;
      this.won = false;
      this.lastPop = '';
      this.lastGateAt = -Infinity;
    }
    const next: Cue[] = [];
    const keyword = `${round.id}:${round.keyword}`;
    const weak = round.boss?.weakPointActive === true;
    const won = round.boss !== undefined && round.boss.hp <= 0;
    if (won && !this.won) next.push('gg');
    else if (weak && !this.weak) next.push('weak');
    else if (keyword !== this.keyword && round.phase === 'active') next.push('keyword');
    const pop = match.feedback?.pops.at(-1);
    const popId = pop ? `${match.feedback?.roundId}:${pop.id}` : '';
    if (round.gate && popId && popId !== this.lastPop && match.elapsedMs - this.lastGateAt >= 450) {
      if (!next.length) next.push('gate');
      this.lastGateAt = match.elapsedMs;
    }
    this.keyword = keyword;
    this.weak = weak;
    this.won = won || this.won;
    this.lastPop = popId;
    return next;
  }
}
