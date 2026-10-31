import { describe, expect, it } from 'vitest';
import { AfterglowTracker } from '../src/afterglow.js';

describe('ephemeral afterglow tracking', () => {
  it('counts unique raiders seen in the last 2 minutes only', () => {
    let now = 180_000;
    const tracker = new AfterglowTracker(180_000, () => now);
    tracker.observe('raider1', 'raiders', 60_000);
    tracker.observe('raider1', 'raiders', 180_000);
    tracker.observe('raider2', 'raiders', 60_000);
    tracker.observe('home1', 'home', 180_000);
    expect(tracker.view().count).toBe(2);
    now = 180_001;
    expect(tracker.view().count).toBe(1);
  });

  it('captures the final number at exactly +5 minutes and clears viewer memory', () => {
    let now = 100_000;
    const tracker = new AfterglowTracker(0, () => now);
    tracker.observe('gone', 'raiders');
    now = 180_000;
    tracker.observe('boundary', 'raiders');
    now = 299_999;
    tracker.observe('present', 'raiders');
    now = 300_000;
    expect(tracker.view()).toEqual({ count: 2, remainingMs: 0, finished: true, finalCount: 2 });
    expect(tracker.size).toBe(0);
    now = 1_000_000;
    tracker.observe('late', 'raiders');
    expect(tracker.view().finalCount).toBe(2);
    expect(tracker.size).toBe(0);
  });

  it('uses the deadline cutoff even if the final poll arrives late', () => {
    let now = 200_000;
    const tracker = new AfterglowTracker(0, () => now);
    tracker.observe('viewer', 'raiders');
    now = 500_000;
    expect(tracker.view().finalCount).toBe(1);
  });

  it('ignores future messages and late older duplicates, and handles team corrections', () => {
    let now = 1_000;
    const tracker = new AfterglowTracker(0, () => now);
    tracker.observe('future', 'raiders', 2_000);
    tracker.observe('viewer', 'raiders', 1_000);
    tracker.observe('viewer', 'raiders', 0);
    now = 120_001;
    expect(tracker.view().count).toBe(1);
    tracker.observe('viewer', 'home');
    expect(tracker.view().count).toBe(0);
  });
});
