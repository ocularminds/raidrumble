import type { ArenaView } from '../../server/src/model.js';
import type { MatchView, RoundView } from '@raidrumble/engine';
import { Paint, palette } from './draw.js';
import { Scenes } from './scenes.js';
import { Compact } from './compact.js';
import { Feedback } from './feedback.js';

export class Arena {
  private readonly paint: Paint;
  private readonly scenes: Scenes;
  private readonly compact: Compact;
  private readonly feedback: Feedback;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly preview: boolean,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    this.paint = new Paint(ctx);
    this.scenes = new Scenes(this.paint);
    this.compact = new Compact(this.paint);
    this.feedback = new Feedback(this.paint);
  }

  draw(view: ArenaView | undefined, time: number): void {
    const p = this.paint;
    p.ctx.clearRect(0, 0, 1920, 1080);
    if (view?.status === 'incoming' || view?.status === 'pending') {
      this.compact.notice(view);
      return;
    }
    if (!view || view.status === 'idle') {
      if (this.preview) {
        if (view?.layout === 'full') this.idle(view);
        else this.compact.notice(view);
      }
      return;
    }
    if (view.status === 'afterglow') {
      this.afterglow(view);
      return;
    }
    const match = view.match;
    if (!match) return;
    if (view.layout !== 'full') {
      this.compact.draw(view);
      return;
    }
    p.panel(60, 42, 1800, 980, 40);
    this.header(view);
    if (match.status !== 'playing') {
      this.endcard(match, view);
      return;
    }
    const round = match.round;
    if (!round) return;
    this.roundTitle(round, match.roundIndex, match.roundCount);
    const motion = view.reducedMotion ? 0 : time / 700;
    if (round.gate) this.scenes.gate(round, motion);
    else if (round.quiz) this.scenes.quiz(round);
    else if (round.boss) this.scenes.boss(round, motion);
    else p.wrap(round.instruction, 960, 470, 1400, 56);
    this.feedback.pops(view, { home: [365, 663], raiders: [1555, 663] }, 430);
    this.feedback.streaks(view, 250, 892, 1560);
    p.line(105, 915, 1815, 915, palette.line);
    p.text('WRONG TEAM? SWITCH BEFORE YOUR FIRST MOVE', 124, 963, 25, palette.muted);
    p.text('!join home  ●', 1245, 963, 32, palette.home, 'center');
    p.text('!join raiders  ▲', 1630, 963, 32, palette.raiders, 'center');
  }

  private header(view: ArenaView): void {
    const p = this.paint;
    p.shape('home', 133, 110, 17);
    p.text('HOME GUARD', 170, 93, 29, palette.home, 'left', 800);
    p.text(p.fit(view.hostName, 450, 38), 170, 137, 38);
    p.shape('raiders', 1785, 109, 18);
    p.text('RAIDERS', 1744, 93, 29, palette.raiders, 'right', 800);
    p.text(p.fit(view.raiderName, 450, 38), 1744, 137, 38, palette.white, 'right');
    p.text('RAIDRUMBLE', 960, 86, 32, palette.lime, 'center', 900);
    p.text(
      view.practice === 'realchat'
        ? 'TEST RAID · REAL TWITCH CHAT'
        : (view.rematch ?? (view.simulated ? 'LOCAL SIMULATION' : 'TWO COMMUNITIES. ONE ARENA.')),
      960,
      133,
      25,
      palette.muted,
      'center',
    );
  }

  private roundTitle(round: RoundView, index: number, count: number): void {
    const p = this.paint;
    p.text(
      `${String(index + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}  ·  ${round.title.toUpperCase()}`,
      125,
      237,
      29,
      palette.muted,
    );
    p.text(
      round.phase === 'finished'
        ? 'CELEBRATE IN CHAT'
        : round.phase === 'reveal'
          ? 'THE REVEAL'
          : 'TYPE IN CHAT',
      960,
      211,
      27,
      palette.muted,
      'center',
    );
    p.text(
      round.phase === 'finished' ? 'GG' : p.fit(round.keyword || 'TOGETHER', 970, 82),
      960,
      277,
      82,
      palette.lime,
      'center',
      900,
    );
    const ctx = p.ctx;
    ctx.beginPath();
    ctx.arc(1750, 260, 48, 0, 2 * Math.PI);
    ctx.strokeStyle = '#354252';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(
      1750,
      260,
      48,
      -Math.PI / 2,
      -Math.PI / 2 + (2 * Math.PI * round.remainingMs) / round.durationMs,
    );
    ctx.strokeStyle = palette.lime;
    ctx.stroke();
    p.text(
      String(Math.ceil(round.remainingMs / 1000)),
      1750,
      260,
      39,
      palette.white,
      'center',
      800,
    );
  }

  private idle(view: ArenaView | undefined): void {
    const p = this.paint;
    p.panel(60, 42, 1800, 980, 40, 'rgba(15,23,35,.78)');
    p.text('RAIDRUMBLE', 960, 173, 38, palette.lime, 'center', 900);
    p.shape('home', 838, 370, 55);
    p.shape('raiders', 1084, 370, 57);
    p.text('+', 960, 370, 50, palette.muted, 'center');
    p.text(
      view?.status === 'pending' ? 'A CHALLENGE AWAITS.' : 'MAKE AN ENTRANCE.',
      960,
      536,
      86,
      palette.white,
      'center',
      900,
    );
    p.text(
      view?.status === 'pending'
        ? 'Waiting for the host to accept.'
        : 'One raid. Three rounds. A reason to stay.',
      960,
      642,
      39,
      palette.muted,
      'center',
    );
    p.line(466, 768, 1454, 768, palette.line);
    p.text('01  SIEGE', 533, 839, 32, palette.home, 'center');
    p.text('02  KNOW YOUR HOST', 960, 839, 32, palette.white, 'center');
    p.text('03  FUSION BOSS', 1387, 839, 32, palette.raiders, 'center');
    p.text('1920 × 1080  ·  OBS READY', 960, 951, 26, palette.muted, 'center');
  }

  private endcard(match: MatchView, view: ArenaView): void {
    const p = this.paint;
    const killed = match.results.some(
      (result) => result.roundId === 'fusion-boss' && result.winner === 'both',
    );
    p.text(
      killed ? 'BETTER TOGETHER.' : 'THE NEXT RAID IS A REMATCH.',
      960,
      302,
      killed ? 90 : 66,
      palette.lime,
      'center',
      900,
    );
    p.text(
      killed
        ? 'Boss defeated. Two communities, one victory.'
        : 'One arena. A new community. See you for round two.',
      960,
      402,
      40,
      palette.muted,
      'center',
    );
    const last = match.results.at(-1);
    for (const team of ['home', 'raiders'] as const) {
      const x = team === 'home' ? 530 : 1390;
      p.text(
        team === 'home' ? '● HOME GUARD MVPS' : '▲ RAIDER MVPS',
        x,
        535,
        34,
        palette[team],
        'center',
        800,
      );
      const mvps = last?.mvps[team] ?? [];
      mvps.slice(0, 3).forEach((mvp, index) => {
        p.text(
          `${index + 1}. ${p.fit(mvp.displayName ?? `Player ${index + 1}`, 525, 40)}`,
          x,
          620 + index * 78,
          40,
          palette.white,
          'center',
        );
      });
    }
    p.text(
      p.fit(`▲ Raiders: follow ${view.hostName}`, 1540, 32),
      960,
      867,
      32,
      palette.raiders,
      'center',
    );
    p.text(
      p.fit(`● Home Guard: check out ${view.raiderName}`, 1540, 32),
      960,
      921,
      32,
      palette.home,
      'center',
    );
  }

  private afterglow(view: ArenaView): void {
    const p = this.paint;
    p.panel(1250, 880, 610, 142, 25);
    p.text('▲ RAIDERS STILL HERE', 1290, 922, 29, palette.raiders);
    p.text(String(view.afterglow?.count ?? 0), 1800, 950, 62, palette.white, 'right', 800);
    p.text('The raid is over. The connection stays.', 1290, 977, 24, palette.muted);
  }
}
