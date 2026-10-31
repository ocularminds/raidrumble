import type { RoundView } from '@raidrumble/engine';
import { Paint, palette } from './draw.js';

export class Scenes {
  constructor(private readonly paint: Paint) {}

  gate(round: RoundView, motion: number): void {
    const p = this.paint;
    const ctx = p.ctx;
    const position = Math.max(0, Math.min(1, round.gate?.position ?? 0.5));
    const center = 960 + (position - 0.5) * 120;
    ctx.save();
    ctx.shadowColor = position > 0.5 ? palette.raiders : palette.home;
    ctx.shadowBlur = 28;
    p.panel(center - 147, 355, 294, 276, 130, '#1c2a3c', '#52657a');
    ctx.shadowBlur = 0;
    p.panel(center - 118, 402, 236, 233, 105, '#111a27', '#36475e');
    for (let i = 0; i < 6; i++) {
      const x = center - 88 + i * 35;
      p.line(x, 453 - Math.sin(((i + 1) * Math.PI) / 7) * 34, x, 630, '#64758b', 9);
    }
    p.line(center - 108, 516, center + 108, 516, '#66778c', 11);
    p.line(center - 108, 574, center + 108, 574, '#66778c', 11);
    for (const side of [-1, 1]) {
      const x = center + side * 189 - 44;
      p.panel(x, 412, 88, 244, 5, '#253245', '#55667a');
      for (let i = 0; i < 3; i++) p.panel(x + i * 30, 389, 25, 35, 3, '#35465b', '#55667a');
      for (let i = 1; i < 4; i++) p.line(x, 412 + i * 55, x + 88, 412 + i * 55, '#526176');
    }
    ctx.restore();
    p.text('HOLD THE LINE', 400, 484, 37, palette.home, 'center', 800);
    p.text('BREAK THE GATE', 1520, 484, 37, palette.raiders, 'center', 800);
    for (let i = 0; i < 3; i++) {
      const shift = Math.sin(motion + i) * 5;
      p.line(515 + i * 39 + shift, 556, 535 + i * 39 + shift, 578, palette.home, 6);
      p.line(535 + i * 39 + shift, 578, 515 + i * 39 + shift, 600, palette.home, 6);
      p.line(1405 - i * 39 - shift, 556, 1385 - i * 39 - shift, 578, palette.raiders, 6);
      p.line(1385 - i * 39 - shift, 578, 1405 - i * 39 - shift, 600, palette.raiders, 6);
    }
    p.panel(270, 720, 1380, 40, 20, '#2b3646', '#3c4b5f');
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(273, 723, 1374, 34, 17);
    ctx.clip();
    ctx.fillStyle = palette.home;
    ctx.fillRect(273, 723, 1374 * (1 - position), 34);
    ctx.fillStyle = palette.raiders;
    ctx.fillRect(273 + 1374 * (1 - position), 723, 1374 * position, 34);
    ctx.restore();
    p.line(960, 703, 960, 777, palette.white, 4);
    p.text('PARTICIPATION WINS. EVERY VIEWER COUNTS ONCE.', 960, 821, 30, palette.muted, 'center');
  }

  quiz(round: RoundView): void {
    const quiz = round.quiz;
    if (!quiz) return;
    const p = this.paint;
    const team = quiz.scoringTeam;
    p.text(
      `QUESTION ${quiz.index + 1} / ${quiz.total}  ·  ${team === 'raiders' ? '▲ RAIDERS' : '● HOME GUARD'} ANSWER`,
      960,
      344,
      32,
      palette[team],
      'center',
    );
    p.wrap(quiz.prompt, 960, 420, 1350, 54);
    quiz.choices.forEach((choice, index) => {
      const letter = (['A', 'B', 'C'] as const)[index];
      const x = 182 + index * 526;
      const correct = quiz.answer === letter;
      p.panel(
        x,
        535,
        504,
        310,
        24,
        correct ? '#263b2c' : palette.ink,
        correct ? palette.lime : '#435164',
      );
      p.text(letter ?? '', x + 48, 578, 36, correct ? palette.lime : palette[team], 'center', 800);
      p.wrap(choice, x + 252, 714, 440, 32, palette.white, 6, true);
    });
    if (quiz.answer)
      p.text(
        `ANSWER ${quiz.answer}  ·  ${p.fit(quiz.explanation ?? 'Now you know your neighbours.', 1400, 32)}`,
        960,
        884,
        32,
        palette.lime,
        'center',
      );
    else
      p.text(
        'Your first answer counts. Meet the community on the other side.',
        960,
        884,
        32,
        palette.muted,
        'center',
      );
  }

  boss(round: RoundView, motion: number): void {
    const boss = round.boss;
    if (!boss) return;
    const p = this.paint;
    const ctx = p.ctx;
    const defeated = boss.hp <= 0;
    const color = defeated || boss.weakPointActive ? palette.lime : '#c2a6f4';
    const bob = Math.sin(motion) * 7;
    p.text(p.fit(boss.name.toUpperCase(), 1380, 44), 960, 342, 44, color, 'center', 800);
    ctx.save();
    ctx.translate(960, 528 + bob);
    ctx.shadowColor = color;
    ctx.shadowBlur = 34;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4 + Math.PI / 8;
      const x = Math.cos(angle) * 125;
      const y = Math.sin(angle) * 125;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#322b48';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.shadowBlur = 0;
    p.line(-57, -13, -22, -3, color, 13);
    p.line(22, -3, 57, -13, color, 13);
    p.line(-31, 54, 31, 54, color, 8);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 75, -89);
      ctx.lineTo(side * 139, -173);
      ctx.lineTo(side * 127, -36);
      ctx.strokeStyle = color;
      ctx.lineWidth = 8;
      ctx.stroke();
    }
    ctx.restore();
    p.text('● + ▲', 493, 503, 60, palette.lime, 'center');
    p.text(defeated ? 'BOSS DEFEATED' : 'ONE SHARED BOSS', 1467, 503, 32, palette.white, 'center');
    p.text('BOTH TEAMS. ONE WIN.', 1467, 553, 30, palette.muted, 'center');
    p.panel(320, 720, 1280, 38, 19, '#2c2938', '#564e68');
    const health = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
    if (health > 0) p.panel(323, 723, Math.max(1, 1274 * health), 32, 16, color, color);
    p.text(`${Math.ceil(boss.hp)} / ${boss.maxHp} HP`, 960, 800, 32, color, 'center');
    p.text(
      defeated
        ? 'VICTORY FOR BOTH COMMUNITIES · MEET YOUR MVPs AT THE END'
        : boss.weakPointActive
          ? 'WEAK POINT OPEN · TRIPLE DAMAGE'
          : p.fit(boss.flavour, 1450, 32),
      960,
      853,
      32,
      boss.weakPointActive ? palette.lime : palette.muted,
      'center',
    );
  }
}
