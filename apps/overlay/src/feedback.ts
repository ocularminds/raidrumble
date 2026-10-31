import type { Team } from '@raidrumble/engine';
import type { ArenaView } from '../../server/src/model.js';
import { Paint, palette } from './draw.js';

/** Presentation only: the server supplies gated, counted, short-lived feedback. */
export class Feedback {
  constructor(private readonly paint: Paint) {}

  pops(view: ArenaView, positions: Record<Team, [number, number]>, width: number): void {
    const match = view.match;
    if (!match?.feedback) return;
    for (const team of ['home', 'raiders'] as const) {
      const pop = match.feedback.pops
        .filter((item) => item.team === team && item.expiresAtMs > match.elapsedMs)
        .at(-1);
      if (!pop) continue;
      const [x, y] = positions[team];
      const age = Math.max(0, match.elapsedMs - pop.atMs) / 1600;
      const p = this.paint;
      p.ctx.save();
      p.ctx.globalAlpha = view.reducedMotion ? 1 : Math.max(0.35, 1 - age * 0.65);
      p.text(
        p.fit(`+${pop.amount} @${pop.displayName}`, width, 32),
        x,
        y - (view.reducedMotion ? 0 : age * 12),
        32,
        palette[team],
        'center',
        800,
      );
      p.ctx.restore();
    }
  }

  streaks(view: ArenaView, x: number, y: number, width: number, vertical = false): void {
    const match = view.match;
    if (!match?.feedback) return;
    const team: Team = Math.floor(match.elapsedMs / 4000) % 2 === 0 ? 'home' : 'raiders';
    const entries = match.feedback.streaks[team];
    if (!entries.length) return;
    const p = this.paint;
    const prefix = team === 'home' ? '●' : '▲';
    if (vertical) p.text(`${prefix} TOP MOVE STREAKS`, x, y - 40, 22, palette[team]);
    entries.slice(0, 3).forEach((entry, index) => {
      const cell = vertical ? width : width / 3;
      const label = `${prefix} ${p.fit(entry.displayName, cell - 110, 32)} · ${entry.count}`;
      p.text(
        label,
        x + (vertical ? 0 : index * cell),
        y + (vertical ? index * 43 : 0),
        32,
        palette[team],
      );
    });
  }
}
