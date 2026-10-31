import { describe, expect, it } from 'vitest';
import { safeContent } from '@raidrumble/content';
import { createContext } from '@raidrumble/engine';
import { Game } from '../src/services/game.js';

function game(simulated = true) {
  return new Game({
    hostId: 'demo',
    raiderId: 'pixel',
    simulated,
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
    expect(view.results[0]?.winner).toBe('home');
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
});
