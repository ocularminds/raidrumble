import { describe, expect, it } from 'vitest';
import { Contributors } from '../src/feedback.js';
import { input } from './fixture.js';

describe('ephemeral counted contributor feedback', () => {
  const feedback = new Contributors();

  it('only projects supplied gated names, never viewer IDs or input text', () => {
    let state = feedback.start('siege');
    state = feedback.count(state, input(0), 0);
    expect(feedback.view(state, 0).pops).toEqual([]);
    state = feedback.count(
      state,
      input(100, { userId: 'privateid', value: 'PRIVATECOMMAND', displayName: 'Gated Viewer' }),
      100,
    );
    expect(feedback.view(state, 100).pops).toEqual([
      { id: 1, team: 'home', displayName: 'Gated Viewer', amount: 1, atMs: 100, expiresAtMs: 1700 },
    ]);
    expect(JSON.stringify(feedback.view(state, 100))).not.toMatch(/privateid|PRIVATECOMMAND/);
  });

  it('expires pops at their exact deadline and clears missed-window streak identities', () => {
    const original = feedback.start('siege');
    const counted = feedback.count(original, input(1999, { displayName: 'One' }), 1999);
    expect(feedback.view(counted, 3598).pops).toHaveLength(1);
    expect(feedback.view(counted, 3599).pops).toHaveLength(0);
    expect(feedback.view(counted, 3999).streaks.home).toEqual([{ displayName: 'One', count: 1 }]);
    const expired = feedback.tick(counted, 4000);
    expect(feedback.view(expired, 4000).streaks.home).toEqual([]);
    expect(expired.participants.size).toBe(0);
    expect(original.participants.size).toBe(0);
  });

  it('counts consecutive windows, resets gaps, and ranks only three streaks per team', () => {
    let state = feedback.start('fusion-boss');
    for (let window = 0; window < 4; window++) {
      for (let viewer = window; viewer < 5; viewer++) {
        state = feedback.count(
          state,
          input(window * 2000, { userId: `id${viewer}`, displayName: `Viewer ${viewer}` }),
          window * 2000,
        );
      }
    }
    expect(feedback.view(state, 6000).streaks.home).toEqual([
      { displayName: 'Viewer 3', count: 4 },
      { displayName: 'Viewer 4', count: 4 },
      { displayName: 'Viewer 2', count: 3 },
    ]);
    state = feedback.count(state, input(10000, { userId: 'id4', displayName: 'Viewer 4' }), 10000);
    expect(feedback.view(state, 10000).streaks.home).toEqual([
      { displayName: 'Viewer 4', count: 1 },
    ]);
  });

  it('bounds pops evenly between teams and never doubles a same-window streak', () => {
    let state = feedback.start('siege');
    for (const team of ['home', 'raiders'] as const) {
      for (let index = 0; index < 30; index++) {
        state = feedback.count(
          state,
          input(0, { userId: `${team}${index}`, team, displayName: `${team} ${index}` }),
          0,
        );
      }
    }
    const view = feedback.view(state, 0);
    expect(view.pops.filter((pop) => pop.team === 'home')).toHaveLength(6);
    expect(view.pops.filter((pop) => pop.team === 'raiders')).toHaveLength(6);
    const repeated = feedback.count(state, input(0, { userId: 'home0', displayName: 'home 0' }), 0);
    expect(feedback.view(repeated, 0).streaks.home[0]?.count).toBe(1);
  });

  it('is deterministic across ticks and starts each round without the previous names', () => {
    const first = feedback.count(feedback.start('siege'), input(0, { displayName: 'One' }), 0);
    const stepped = feedback.tick(feedback.tick(first, 800), 2000);
    expect(feedback.view(stepped, 2000)).toEqual(feedback.view(feedback.tick(first, 2000), 2000));
    expect(feedback.view(feedback.start('fusion-boss'), 110000)).toEqual({
      roundId: 'fusion-boss',
      pops: [],
      streaks: { home: [], raiders: [] },
    });
  });
});
