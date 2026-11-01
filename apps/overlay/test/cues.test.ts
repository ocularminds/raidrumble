import { describe, expect, it } from 'vitest';
import type { ArenaView } from '../../server/src/model.js';
import { CueDetector } from '../src/cues.js';

function frame(sound = true): ArenaView {
  return {
    hostId: 'host',
    hostName: 'Host',
    raiderName: 'Raiders',
    connected: true,
    reducedMotion: false,
    simulated: true,
    sound,
    status: 'active',
    match: {
      matchId: 'one',
      elapsedMs: 1000,
      remainingMs: 179000,
      status: 'playing',
      teams: { home: 5, raiders: 5 },
      roundIndex: 0,
      roundCount: 3,
      results: [],
      winner: 'none',
      degraded: false,
      round: {
        id: 'siege',
        title: 'Siege',
        phase: 'active',
        keyword: 'PUSH',
        instruction: '',
        durationMs: 60000,
        elapsedMs: 1000,
        remainingMs: 59000,
        progress: 0.5,
        scores: { home: 0, raiders: 0 },
        gate: { position: 0.5, force: { home: 0, raiders: 0 } },
      },
    },
  };
}

describe('opt-in sound cues', () => {
  it('is silent when sound is off or absent', () => {
    const detector = new CueDetector();
    expect(detector.update(frame(false))).toEqual([]);
    expect(detector.update({ ...frame(), sound: undefined })).toEqual([]);
  });

  it('does not repeat a keyword cue for identical 10Hz snapshots', () => {
    const detector = new CueDetector();
    const value = frame();
    expect(detector.update(value)).toEqual(['keyword']);
    expect(detector.update(value)).toEqual([]);
    value.match = { ...value.match!, round: { ...value.match!.round!, keyword: 'HOLD' } };
    expect(detector.update(value)).toEqual(['keyword']);
  });

  it('plays weak-point and victory transitions once', () => {
    const detector = new CueDetector();
    const value = frame();
    value.match = {
      ...value.match!,
      round: {
        ...value.match!.round!,
        id: 'boss',
        gate: undefined,
        keyword: '!hit',
        boss: {
          name: 'Boss',
          flavour: '',
          hp: 10,
          maxHp: 10,
          weakPoint: 'SPARK',
          weakPointActive: false,
          weakPointRemainingMs: 0,
        },
      },
    };
    detector.update(value);
    value.match = {
      ...value.match,
      round: {
        ...value.match.round!,
        boss: { ...value.match.round!.boss!, weakPointActive: true },
      },
    };
    expect(detector.update(value)).toContain('weak');
    expect(detector.update(value)).toEqual([]);
    value.match = {
      ...value.match,
      round: { ...value.match.round!, boss: { ...value.match.round!.boss!, hp: 0 } },
    };
    expect(detector.update(value)).toEqual(['gg']);
    expect(detector.update(value)).toEqual([]);
  });
});
