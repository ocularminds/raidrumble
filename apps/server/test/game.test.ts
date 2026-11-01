import { describe, expect, it } from 'vitest';
import { safeContent } from '@raidrumble/content';
import { createContext } from '@raidrumble/engine';
import { Game } from '../src/services/game.js';

function game(simulated = true, collab = false) {
  return new Game({
    hostId: 'demo',
    raiderId: 'pixel',
    simulated,
    collab,
    context: createContext({
      matchId: 'test',
      seed: 4,
      nowMs: 0,
      teams: { home: 20, raiders: 300 },
      content: safeContent(),
    }),
  });
}

describe('registered rounds running together', () => {
  it('runs the three-minute match with all three plug-ins and a co-op victory', () => {
    const session = game();
    for (let tick = 0; tick < 1800; tick++) session.step(100);
    const view = session.view();
    expect(view.status).toBe('finished');
    expect(view.results.map((round) => round.roundId)).toEqual([
      'siege',
      'know-your-host',
      'fusion-boss',
    ]);
    expect(view.results[0]?.winner).toBe('raiders');
    expect(view.results[2]?.winner).toBe('both');
    expect(view.degraded).toBe(false);
    expect(view.remainingMs).toBe(0);
  });

  it('does not forward arbitrary chat into snapshots or lock an ignored input', () => {
    const session = game(false);
    const message = {
      userId: 'viewer',
      text: 'raw text that is not a command',
      displayName: 'Viewer',
    };
    expect(session.chat(message)).toBe(false);
    session.chat({ ...message, text: '!join home' });
    expect(session.assignment('viewer')?.team).toBe('home');
    expect(session.assignment('viewer')?.locked).toBe(false);
    const keyword = session.view().round!.keyword;
    expect(session.chat({ ...message, text: keyword })).toBe(true);
    session.chat({ ...message, text: '!join raiders' });
    expect(session.assignment('viewer')?.team).toBe('home');
    expect(JSON.stringify(session.view())).not.toContain(message.text);
  });

  it('shows a gated contributor once for a counted move and expires the pop during idle ticks', () => {
    const session = game(false);
    const keyword = session.view().round!.keyword;
    const chat = { userId: 'privateviewer', text: keyword, displayName: 'Approved Name' };
    expect(session.chat(chat)).toBe(true);
    for (let index = 0; index < 100; index++) expect(session.chat(chat)).toBe(false);
    expect(session.view().feedback?.pops).toHaveLength(1);
    expect(session.view().feedback?.streaks.home).toEqual([
      { displayName: 'Approved Name', count: 1 },
    ]);
    expect(JSON.stringify(session.view().feedback)).not.toContain('privateviewer');
    session.step(1600);
    expect(session.view().feedback?.pops).toHaveLength(0);
    session.step(2400);
    expect(session.view().feedback?.streaks.home).toEqual([]);
  });

  it('never shows contributor feedback for a quiz answer and resets it before the boss', () => {
    const session = game(false);
    session.chat({ userId: 'one', text: session.view().round!.keyword, displayName: 'Approved' });
    session.step(60_000);
    session.chat({ userId: 'two', text: '!join raiders' });
    expect(session.chat({ userId: 'two', text: 'A', displayName: 'Quiz Viewer' })).toBe(true);
    expect(session.view().feedback).toBeUndefined();
    session.step(50_000);
    const keyword = session.view().round!.keyword;
    expect(session.chat({ userId: 'two', text: keyword, displayName: 'Approved Boss' })).toBe(true);
    expect(session.view().feedback?.pops).toEqual([
      expect.objectContaining({ displayName: 'Approved Boss', amount: 1, atMs: 110_000 }),
    ]);
    session.step(70_000);
    expect(session.view().feedback).toBeUndefined();
  });

  it('makes the normal demo a close Raider comeback only in the final ten seconds', () => {
    const session = game();
    session.step(50_000);
    expect(session.view().round?.gate?.position).toBeLessThan(0.5);
    session.step(6000);
    expect(session.view().round?.gate?.position).toBeLessThan(0.5);
    session.step(2000);
    expect(session.view().round?.gate?.position).toBeGreaterThan(0.5);
    session.step(2000);
    expect(session.view().results[0]).toMatchObject({
      winner: 'raiders',
      stats: { windows: 30 },
    });
    expect(session.view().results[0]!.stats.gatePosition).toBeLessThan(0.55);
    expect(session.view().teams).toEqual({ home: 20, raiders: 300 });
  });

  it('keeps the collab demo home-favored and its Shared Chat assignments exact', () => {
    const session = game(true, true);
    session.step(180_000);
    expect(session.view().results[0]?.winner).toBe('home');
    expect(session.view().results[2]?.winner).toBe('both');
    expect(session.assignment('raider0')).toMatchObject({
      team: 'raiders',
      source: 'shared',
      confidence: 1,
    });
  });

  it('replays the comeback and co-op outcome identically across timer partitions', () => {
    const whole = game();
    const split = game();
    whole.step(180_000);
    for (let time = 0; time < 180_000; time += 100) split.step(100);
    expect(whole.view()).toEqual(split.view());
  });
});
