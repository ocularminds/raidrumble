import type { MatchView, RoundView } from '@raidrumble/engine';
import type { ArenaView } from '../../server/src/model.js';
import { Paint, palette } from './draw.js';
import { Feedback } from './feedback.js';

/** Native-size layouts, never a scaled-down Full Arena. */
export class Compact {
  private readonly feedback: Feedback;
  constructor(private readonly p: Paint) {
    this.feedback = new Feedback(p);
  }

  draw(view: ArenaView): void {
    const rail = view.layout === 'rail';
    const p = this.p;
    p.panel(rail ? 1328 : 32, rail ? 32 : 760, rail ? 560 : 1856, rail ? 1016 : 288, 24);
    const match = view.match;
    if (!match) return;
    if (match.status !== 'playing') {
      this.end(view, match, rail);
      return;
    }
    const round = match.round;
    if (!round) return;
    if (rail) this.rail(view, round);
    else this.lower(view, round);
  }

  notice(view: ArenaView | undefined): void {
    const p = this.p;
    const incoming = view?.status === 'incoming';
    const pending = view?.status === 'pending';
    const rail = view?.layout === 'rail';
    const x = rail ? 1328 : 480;
    const y = rail ? 32 : 856;
    const width = rail ? 560 : 960;
    p.panel(x, y, width, 192, 24);
    p.text(
      incoming ? 'RAID INCOMING' : pending ? 'HOST REVIEWING' : 'RAIDRUMBLE',
      x + width / 2,
      y + 55,
      rail ? 44 : 52,
      palette.lime,
      'center',
      900,
    );
    p.wrap(
      incoming
        ? 'Checking this challenge.'
        : pending
          ? 'Waiting for the host to accept.'
          : 'One raid. Three rounds. A reason to stay.',
      x + width / 2,
      y + 116,
      width - 64,
      28,
      palette.muted,
      2,
      true,
    );
  }

  private lower(view: ArenaView, round: RoundView): void {
    const p = this.p;
    const match = view.match!;
    p.text(
      `${match.roundIndex + 1} / ${match.roundCount} · ${round.title.toUpperCase()}`,
      64,
      790,
      23,
      palette.muted,
    );
    p.text(this.label(view), 1740, 790, 20, palette.muted, 'right');
    this.timer(round, 1822, 806, 33);
    if (round.quiz) {
      this.quiz(round, false);
      return;
    }
    p.shape('home', 78, 857, 13);
    p.text(p.fit(view.hostName, 440, 32), 106, 857, 32, palette.home);
    p.shape('raiders', 1820, 866, 13);
    p.text(p.fit(view.raiderName, 440, 32), 1788, 863, 32, palette.raiders, 'right');
    p.text(
      round.phase === 'finished'
        ? 'CELEBRATE IN CHAT'
        : round.boss
          ? p.fit(round.boss.name.toUpperCase(), 730, 23)
          : 'TYPE IN CHAT',
      960,
      795,
      21,
      palette.muted,
      'center',
    );
    p.text(
      p.fit(round.phase === 'finished' ? 'GG' : round.keyword, 740, 64),
      960,
      846,
      64,
      palette.lime,
      'center',
      900,
    );
    if (round.gate) {
      this.gate(round, 340, 903, 1240);
      p.text('● HOLD', 252, 914, 27, palette.home, 'right');
      p.text('PUSH ▲', 1656, 914, 27, palette.raiders);
    } else if (round.boss) {
      this.health(round, 340, 903, 1240);
    } else p.text(p.fit(round.instruction, 1400, 32), 960, 916, 32, palette.white, 'center');
    this.feedback.pops(view, { home: [278, 959], raiders: [1650, 959] }, 430);
    this.feedback.streaks(view, 555, 1009, 1200);
    if (!match.feedback?.streaks.home.length && !match.feedback?.streaks.raiders.length)
      p.text('ONE MOVE EVERY 2 SECONDS. EVERYONE COUNTS.', 1820, 1009, 23, palette.muted, 'right');
    p.text('WRONG TEAM? !join home / !join raiders', 64, 1013, 22, palette.muted);
  }

  private rail(view: ArenaView, round: RoundView): void {
    const p = this.p;
    p.text('RAIDRUMBLE', 1360, 79, 30, palette.lime, 'left', 900);
    this.timer(round, 1825, 87, 31);
    p.text(this.label(view), 1360, 121, 19, palette.muted);
    p.text(
      `${view.match!.roundIndex + 1} / ${view.match!.roundCount} · ${round.title.toUpperCase()}`,
      1360,
      164,
      24,
      palette.muted,
    );
    if (round.quiz) {
      this.quiz(round, true);
      return;
    }
    p.text('● HOME GUARD', 1360, 214, 22, palette.home);
    p.text(p.fit(view.hostName, 490, 32), 1360, 252, 32, palette.home);
    p.text('▲ RAIDERS', 1360, 310, 22, palette.raiders);
    p.text(p.fit(view.raiderName, 490, 32), 1360, 348, 32, palette.raiders);
    p.text(
      round.phase === 'finished' ? 'CELEBRATE IN CHAT' : 'TYPE IN CHAT',
      1608,
      407,
      23,
      palette.muted,
      'center',
    );
    p.text(
      p.fit(round.phase === 'finished' ? 'GG' : round.keyword, 485, 58),
      1608,
      467,
      58,
      palette.lime,
      'center',
      900,
    );
    if (round.gate) {
      this.gate(round, 1360, 533, 496);
      p.text('● HOLD', 1360, 590, 27, palette.home);
      p.text('PUSH ▲', 1856, 590, 27, palette.raiders, 'right');
    } else if (round.boss) {
      this.health(round, 1360, 533, 496);
      p.text(p.fit(round.boss.name, 496, 28), 1608, 610, 28, '#c2a6f4', 'center');
    } else p.wrap(round.instruction, 1608, 550, 490, 32, palette.white, 3);
    this.feedback.pops(view, { home: [1608, 669], raiders: [1608, 715] }, 490);
    this.feedback.streaks(view, 1360, 800, 496, true);
    p.line(1360, 924, 1856, 924, palette.line);
    p.text('SWITCH BEFORE YOUR FIRST MOVE', 1608, 953, 21, palette.muted, 'center');
    p.text('● !join home', 1360, 1003, 28, palette.home);
    p.text('!join raiders ▲', 1856, 1003, 28, palette.raiders, 'right');
  }

  private quiz(round: RoundView, rail: boolean): void {
    const p = this.p;
    const quiz = round.quiz!;
    p.wrap(
      quiz.prompt,
      rail ? 1608 : 960,
      rail ? 232 : 815,
      rail ? 484 : 1420,
      32,
      palette.white,
      rail ? 3 : 2,
      true,
    );
    quiz.choices.forEach((choice, index) => {
      const letter = ['A', 'B', 'C'][index]!;
      const x = rail ? 1352 : 56 + index * 616;
      const y = rail ? 330 + index * 192 : 867;
      const width = rail ? 512 : 600;
      const height = rail ? 178 : 146;
      const correct = quiz.answer === letter;
      p.panel(
        x,
        y,
        width,
        height,
        16,
        correct ? '#263b2c' : '#172131',
        correct ? palette.lime : '#3b4d61',
      );
      p.text(
        letter,
        x + 39,
        y + 45,
        48,
        correct ? palette.lime : palette[quiz.scoringTeam],
        'center',
        900,
      );
      const textWidth = width - 108;
      const size = p.wrappedSize(choice, textWidth, height - 20, 32, 24);
      p.wrap(
        choice,
        x + 78 + textWidth / 2,
        y + height / 2,
        textWidth,
        size,
        palette.white,
        Math.floor((height - 16) / (size * 1.3)),
        true,
      );
    });
    const instruction = quiz.answer
      ? `ANSWER ${quiz.answer} · NOW YOU KNOW YOUR NEIGHBORS.`
      : `${quiz.scoringTeam === 'home' ? '● HOME GUARD' : '▲ RAIDERS'} · TYPE A, B OR C. FIRST ANSWER COUNTS.`;
    p.wrap(
      instruction,
      rail ? 1608 : 960,
      rail ? 977 : 1031,
      rail ? 490 : 1750,
      rail ? 25 : 21,
      quiz.answer ? palette.lime : palette.muted,
      rail ? 3 : 1,
      true,
    );
  }

  private gate(round: RoundView, x: number, y: number, width: number): void {
    const p = this.p;
    const position = Math.max(0, Math.min(1, round.gate!.position));
    p.panel(x, y, width, 24, 12, '#203047');
    p.ctx.save();
    p.ctx.beginPath();
    p.ctx.roundRect(x + 2, y + 2, width - 4, 20, 10);
    p.ctx.clip();
    p.ctx.fillStyle = palette.home;
    p.ctx.fillRect(x + 2, y + 2, (width - 4) * (1 - position), 20);
    p.ctx.fillStyle = palette.raiders;
    p.ctx.fillRect(x + 2 + (width - 4) * (1 - position), y + 2, (width - 4) * position, 20);
    p.ctx.restore();
    p.line(x + width / 2, y - 7, x + width / 2, y + 31, palette.white, 3);
  }

  private health(round: RoundView, x: number, y: number, width: number): void {
    const p = this.p;
    const boss = round.boss!;
    const ratio = Math.max(0, Math.min(1, boss.hp / Math.max(1, boss.maxHp)));
    const color = boss.weakPointActive || ratio === 0 ? palette.lime : '#c2a6f4';
    p.panel(x, y, width, 24, 12, '#2c2938');
    if (ratio > 0) p.panel(x + 2, y + 2, Math.max(1, (width - 4) * ratio), 20, 10, color, color);
    p.text(
      ratio === 0
        ? 'BOSS DEFEATED'
        : boss.weakPointActive
          ? 'WEAK POINT · 3× DAMAGE'
          : `${Math.ceil(boss.hp)} / ${Math.ceil(boss.maxHp)} HP · ONE SHARED BOSS`,
      x + width / 2,
      y + 53,
      23,
      color,
      'center',
    );
  }

  private end(view: ArenaView, match: MatchView, rail: boolean): void {
    const p = this.p;
    const killed = match.results.some((result) => result.winner === 'both');
    p.text(
      killed ? 'BETTER TOGETHER.' : 'REMATCH SOON.',
      rail ? 1608 : 64,
      rail ? 117 : 811,
      rail ? 42 : 48,
      palette.lime,
      rail ? 'center' : 'left',
      900,
    );
    if (!rail)
      p.wrap(
        killed ? 'Two communities. One victory.' : 'Every rival can be a neighbor.',
        299,
        886,
        470,
        30,
        palette.muted,
        3,
        true,
      );
    const last = match.results.at(-1);
    for (const team of ['home', 'raiders'] as const) {
      const x = rail ? 1360 : team === 'home' ? 620 : 1252;
      const y = rail ? (team === 'home' ? 218 : 464) : 799;
      p.text(team === 'home' ? '● HOME GUARD MVPS' : '▲ RAIDER MVPS', x, y, 23, palette[team]);
      const mvps = last?.mvps[team] ?? [];
      if (!mvps.length)
        p.text('Your next move starts the story.', x, y + 52, rail ? 25 : 28, palette.muted);
      mvps
        .slice(0, 3)
        .forEach((mvp, index) =>
          p.text(
            `${index + 1}. ${p.fit(mvp.displayName ?? 'Neighbor', rail ? 430 : 450, 32)}`,
            x,
            y + 48 + index * 42,
            32,
          ),
        );
    }
    if (rail) {
      p.line(1360, 726, 1856, 726, palette.line);
      p.wrap(`▲ Raiders: follow ${view.hostName}`, 1608, 792, 496, 32, palette.raiders, 3, true);
      p.wrap(`● Check out ${view.raiderName}`, 1608, 910, 496, 32, palette.home, 3, true);
      p.text('MAKE EVERY RAID COUNT.', 1608, 1010, 22, palette.muted, 'center');
    } else {
      p.line(64, 959, 1856, 959, palette.line);
      p.text(p.fit(`▲ Raiders: follow ${view.hostName}`, 860, 32), 64, 1009, 32, palette.raiders);
      p.text(
        p.fit(`● Home Guard: check out ${view.raiderName}`, 860, 32),
        1856,
        1009,
        32,
        palette.home,
        'right',
      );
    }
  }

  private timer(round: RoundView, x: number, y: number, radius: number): void {
    const p = this.p;
    p.ctx.beginPath();
    p.ctx.arc(x, y, radius, 0, Math.PI * 2);
    p.ctx.strokeStyle = palette.line;
    p.ctx.lineWidth = 4;
    p.ctx.stroke();
    p.ctx.beginPath();
    p.ctx.arc(
      x,
      y,
      radius,
      -Math.PI / 2,
      -Math.PI / 2 + (Math.PI * 2 * round.remainingMs) / Math.max(1, round.durationMs),
    );
    p.ctx.strokeStyle = palette.lime;
    p.ctx.stroke();
    p.text(String(Math.ceil(round.remainingMs / 1000)), x, y, 30, palette.white, 'center', 800);
  }

  private label(view: ArenaView): string {
    return view.practice === 'realchat'
      ? 'TEST RAID · REAL TWITCH CHAT'
      : view.simulated
        ? 'LOCAL SIMULATION'
        : 'TWO COMMUNITIES. ONE ARENA.';
  }
}
