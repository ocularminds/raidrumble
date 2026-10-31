import { describe, expect, it } from 'vitest';
import type { ArenaView } from '../../server/src/model.js';
import { Arena } from '../src/arena.js';

export function arenaView(): ArenaView {
  return {
    hostId: 'host',
    hostName: 'Gated Host',
    raiderName: 'Gated Raider',
    connected: true,
    reducedMotion: false,
    simulated: true,
    status: 'active',
    match: {
      matchId: 'match',
      status: 'playing',
      elapsedMs: 1000,
      remainingMs: 179000,
      roundIndex: 0,
      roundCount: 3,
      results: [],
      winner: 'none',
      teams: { home: 20, raiders: 300 },
      degraded: false,
      round: {
        id: 'siege',
        title: 'Siege',
        phase: 'active',
        elapsedMs: 1000,
        durationMs: 60000,
        remainingMs: 59000,
        keyword: 'PUSH',
        instruction: 'Type PUSH',
        progress: 0.5,
        scores: { home: 0, raiders: 0 },
        gate: { position: 0.5, force: { home: 1, raiders: 1 } },
      },
    },
  };
}

function surface() {
  const panels: number[][] = [];
  const labels: { text: string; size: number }[] = [];
  const properties: Record<string, unknown> = { font: '600 32px sans-serif' };
  const context = new Proxy(properties, {
    get(target, key: string) {
      if (key === 'roundRect') return (...args: number[]) => panels.push(args);
      if (key === 'fillText')
        return (text: string) =>
          labels.push({
            text,
            size: Number(/(\d+)px/.exec(String(target.font))?.[1]),
          });
      if (key === 'measureText')
        return (text: string) => ({
          width: text.length * Number(/(\d+)px/.exec(String(target.font))?.[1]) * 0.5,
        });
      return target[key] ?? (() => undefined);
    },
  }) as unknown as CanvasRenderingContext2D;
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  return { arena: new Arena(canvas, false), panels, labels };
}

describe('stream-preserving overlay layouts', () => {
  it('defaults to panels entirely within the bottom 30 percent', () => {
    const { arena, panels, labels } = surface();
    arena.draw(arenaView(), 0);
    expect(panels.length).toBeGreaterThan(0);
    for (const [x, y, width, height] of panels) {
      expect(y).toBeGreaterThanOrEqual(756);
      expect(x! + width!).toBeLessThanOrEqual(1920);
      expect(y! + height!).toBeLessThanOrEqual(1080);
    }
    expect(labels.find((label) => label.text === 'PUSH')?.size).toBeGreaterThanOrEqual(48);
    expect(labels.find((label) => label.text === 'Gated Host')?.size).toBeGreaterThanOrEqual(32);
  });

  it('keeps the left 68 percent of a side-rail scene clear', () => {
    const { arena, panels } = surface();
    arena.draw({ ...arenaView(), layout: 'rail' }, 0);
    expect(panels.length).toBeGreaterThan(0);
    for (const [x, y, width, height] of panels) {
      expect(x).toBeGreaterThanOrEqual(1305);
      expect(x! + width!).toBeLessThanOrEqual(1920);
      expect(y! + height!).toBeLessThanOrEqual(1080);
    }
  });

  it('retains an explicitly selected Full Arena', () => {
    const { arena, panels } = surface();
    arena.draw({ ...arenaView(), layout: 'full' }, 0);
    expect(panels.some(([, , width, height]) => width! > 1700 && height! > 900)).toBe(true);
  });

  it.each(['lower', 'rail', 'full'] as const)(
    'shows follow prompts after either outcome in %s',
    (layout) => {
      for (const won of [true, false]) {
        const { arena, labels } = surface();
        const view = arenaView();
        view.layout = layout;
        view.match = {
          ...view.match!,
          status: 'endcard',
          results: [
            {
              roundId: 'fusion-boss',
              winner: won ? 'both' : 'none',
              mvps: { home: [], raiders: [] },
              stats: {},
            },
          ],
        };
        arena.draw(view, 0);
        expect(labels.some(({ text }) => /follow Gated Host/i.test(text))).toBe(true);
        expect(labels.some(({ text }) => /check out Gated Raider/i.test(text))).toBe(true);
      }
    },
  );

  it('shows only authored incoming text before content is approved', () => {
    const { arena, labels, panels } = surface();
    arena.draw({ ...arenaView(), status: 'incoming', incoming: { expiresAt: 1500 } }, 0);
    expect(labels.some(({ text }) => text.includes('RAID INCOMING'))).toBe(true);
    expect(labels.some(({ text }) => text.includes('Gated'))).toBe(false);
    expect(panels.every(([, y]) => y! >= 756)).toBe(true);
  });

  it('leaves a live idle stream fully transparent', () => {
    const { arena, panels, labels } = surface();
    arena.draw({ ...arenaView(), status: 'idle' }, 0);
    expect(panels).toHaveLength(0);
    expect(labels).toHaveLength(0);
  });
});
