import { describe, expect, it } from 'vitest';
import { AttributionEngine, type AttributionEvidence } from '../src/attribution.js';
import { RosterCapture } from '../src/roster.js';

const engine = new AttributionEngine();
const evidence = (overrides: Partial<AttributionEvidence> = {}): AttributionEvidence => ({
  userId: 'viewer',
  hostId: 'host',
  raiderId: 'raider',
  raidAtMs: 10_000,
  firstHostMessageAtMs: 10_001,
  isRegular: false,
  ...overrides,
});

describe('team attribution', () => {
  it.each([
    ['host', 'home'],
    ['raider', 'raiders'],
  ] as const)('uses the exact Shared Chat source %s', (sourceBroadcasterId, team) => {
    const result = engine.resolve(engine.start(), evidence({ sourceBroadcasterId }));
    expect(result.assignment).toEqual({ team, source: 'shared', confidence: 1, locked: false });
  });

  it('gives Shared Chat precedence over roster and a self-selection', () => {
    const selected = engine.select(engine.start(), 'viewer', 'raiders');
    const result = engine.resolve(
      selected.state,
      evidence({
        sourceBroadcasterId: 'host',
        roster: new Set(['viewer']),
      }),
    );
    expect(result.assignment?.team).toBe('home');
    expect(result.assignment?.source).toBe('shared');
    expect(engine.select(result.state, 'viewer', 'raiders').assignment?.team).toBe('home');
  });

  it('does not attribute a source from an unrelated channel as a team', () => {
    const result = engine.resolve(
      engine.start(),
      evidence({
        sourceBroadcasterId: 'stranger',
        firstHostMessageAtMs: 1,
        isRegular: true,
      }),
    );
    expect(result.assignment?.source).toBe('heuristic');
    expect(result.assignment?.team).toBe('home');
  });

  it('assigns a captured raider with confidence 0.95', () => {
    const result = engine.resolve(engine.start(), evidence({ roster: new Set(['viewer']) }));
    expect(result.assignment).toEqual({
      team: 'raiders',
      source: 'roster',
      confidence: 0.95,
      locked: false,
    });
  });

  it('lets viewers correct roster attribution before their first counted input', () => {
    const assigned = engine.resolve(engine.start(), evidence({ roster: new Set(['viewer']) }));
    const selected = engine.select(assigned.state, 'viewer', 'home');
    expect(selected.assignment).toEqual({
      team: 'home',
      source: 'self',
      confidence: 0.9,
      locked: false,
    });
    const later = engine.resolve(selected.state, evidence({ roster: new Set(['viewer']) }));
    expect(later.assignment?.team).toBe('home');
  });

  it('refuses a self-selection after the first counted input', () => {
    const assigned = engine.resolve(engine.start(), evidence({ roster: new Set(['viewer']) }));
    const locked = engine.lock(assigned.state, 'viewer');
    const selected = engine.select(locked, 'viewer', 'home');
    expect(selected.state).toBe(locked);
    expect(selected.assignment?.team).toBe('raiders');
    expect(selected.assignment?.locked).toBe(true);
  });

  it('locks only when the caller explicitly reports a counted input', () => {
    const assigned = engine.resolve(engine.start(), evidence());
    expect(assigned.assignment?.locked).toBe(false);
    expect(engine.select(assigned.state, 'viewer', 'home').assignment?.team).toBe('home');
    expect(engine.lock(assigned.state, 'unknown')).toBe(assigned.state);
  });

  it('allows authoritative Shared Chat to correct a prior heuristic even when locked', () => {
    const assigned = engine.resolve(engine.start(), evidence());
    const locked = engine.lock(assigned.state, 'viewer');
    const corrected = engine.resolve(locked, evidence({ sourceBroadcasterId: 'host' }));
    expect(corrected.assignment).toEqual({
      team: 'home',
      source: 'shared',
      confidence: 1,
      locked: true,
    });
  });

  it.each([
    [{ firstHostMessageAtMs: 10_001, isRegular: false }, 'raiders'],
    [{ firstHostMessageAtMs: 1, isRegular: true }, 'home'],
    [
      { firstHostMessageAtMs: 10_001, isRegular: true, chatterDelta: new Set(['viewer']) },
      'raiders',
    ],
    [{ firstHostMessageAtMs: 1, isRegular: false, chatterDelta: new Set(['viewer']) }, 'raiders'],
    [{ firstHostMessageAtMs: 10_000, isRegular: true }, 'home'],
    [{ firstHostMessageAtMs: undefined, isRegular: undefined }, 'home'],
  ] as const)('combines the available fallback signals %o', (signals, team) => {
    const result = engine.resolve(engine.start(), evidence(signals));
    expect(result.assignment?.team).toBe(team);
    expect(result.assignment?.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.assignment?.confidence).toBeLessThanOrEqual(0.8);
  });

  it.each([
    ['!join raiders', 'raiders'],
    ['!join red', 'raiders'],
    ['!join home', 'home'],
    [' !JOIN BLUE ', 'home'],
  ] as const)('recognises %s', (message, team) => {
    expect(engine.parseSelection(message)).toBe(team);
  });

  it('does not accept arbitrary text as a self-selection', () => {
    expect(engine.parseSelection('hi !join raiders')).toBeUndefined();
    expect(engine.parseSelection('!join home raiders')).toBeUndefined();
  });

  it('does not mutate previous state and has no persistent roster', () => {
    const initial = engine.start();
    engine.resolve(initial, evidence());
    expect(initial.assignments.size).toBe(0);
    expect(engine.start().assignments.size).toBe(0);
  });
});

describe('ephemeral roster capture', () => {
  const roster = new RosterCapture();

  it('uses only the previous 30 minutes, including the boundary', () => {
    let state = roster.start();
    state = roster.record(state, 'old', 0);
    state = roster.record(state, 'boundary', 1);
    state = roster.record(state, 'recent', 1_800_000);
    expect([...roster.snapshot(state, 1_800_001)]).toEqual(['boundary', 'recent']);
  });

  it('excludes future events and keeps the latest message per viewer', () => {
    let state = roster.record(roster.start(), 'recent', 10);
    state = roster.record(state, 'recent', 9);
    state = roster.record(state, 'future', 100);
    expect(state.get('recent')).toBe(10);
    expect([...roster.snapshot(state, 50)]).toEqual(['recent']);
  });

  it('can discard the roster after a match without mutating a prior snapshot', () => {
    const previous = roster.record(roster.start(), 'viewer', 100);
    const empty = roster.discard();
    expect(empty.size).toBe(0);
    expect(previous.size).toBe(1);
  });
});
