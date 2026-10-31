import { describe, expect, it } from 'vitest';
import { demoChannels } from '@raidrumble/content';
import { defaultPolicy } from '@raidrumble/policy';
import { Room, type RaidRequest, type RoomOptions } from '../src/services/room.js';

const request = (): RaidRequest => ({
  channels: demoChannels,
  raiderLogin: 'pixelpilot',
  accountAgeDays: 300,
  hostFollowsRaider: true,
  viewers: 300,
  roster: new Set(['visitor']),
});
const room = (overrides: Partial<RoomOptions> = {}) =>
  new Room({
    hostId: 'demo',
    config: defaultPolicy(),
    quiet: true,
    now: () => 1_000,
    ...overrides,
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('completed match lifecycle', () => {
  it('seeds Afterglow with tagged raiders who chatted during the end card', async () => {
    const session = room();
    await session.raid(request());
    await session.chat({ userId: 'visitor', text: session.view().match!.round!.keyword });
    session.step(175_000);
    await session.chat({ userId: 'visitor', text: 'great match' });
    session.step(5_000);
    await session.flush();
    expect(session.view().afterglow?.count).toBe(1);
  });

  it('queues settlement before final retention even in a single oversized headless step', async () => {
    const began = deferred<void>();
    const release = deferred<void>();
    const events: string[] = [];
    const session = room({
      onSettle: async () => {
        events.push('settling');
        began.resolve();
        await release.promise;
        events.push('settled');
      },
      onRetention: (_id, count) => {
        events.push(`retention:${count}`);
      },
    });
    await session.raid(request());
    session.step(500_000);
    await began.promise;
    expect(events).toEqual(['settling']);
    release.resolve();
    await session.flush();
    expect(events).toEqual(['settling', 'settled', 'retention:0']);
  });

  it('uses the exact five-minute cutoff when a tick overshoots the deadline', async () => {
    const counts: number[] = [];
    const session = room({
      onRetention: (_id, count) => {
        counts.push(count);
      },
    });
    await session.raid(request());
    await session.chat({ userId: 'visitor', text: session.view().match!.round!.keyword });
    session.step(180_000);
    session.step(220_000);
    await session.chat({ userId: 'visitor', text: 'still here' });
    session.step(200_000);
    await session.flush();
    expect(counts).toEqual([1]);
    expect(session.view().status).toBe('idle');
  });

  it('keeps an older Afterglow alive when a rematch starts', async () => {
    const retained: string[] = [];
    const session = room({
      onRetention: (id) => {
        retained.push(id);
      },
    });
    await session.raid(request());
    const first = session.matchId!;
    session.step(180_000);
    await session.raid(request());
    const second = session.matchId!;
    session.step(180_000);
    session.step(120_000);
    await session.flush();
    expect(retained).toEqual([first]);
    session.step(180_000);
    await session.flush();
    expect(retained).toEqual([first, second]);
    session.step(1_000_000);
    await session.flush();
    expect(retained).toHaveLength(2);
  });

  it('reports a failed settlement and never writes retention against a missing record', async () => {
    let retained = 0;
    const session = room({
      onSettle: () => {
        throw new Error('database unavailable');
      },
      onRetention: () => {
        retained += 1;
      },
    });
    await session.raid(request());
    session.step(500_000);
    await expect(session.flush()).rejects.toThrow(/persist/i);
    expect(retained).toBe(0);
    expect(session.persistenceFailures.length).toBeGreaterThan(0);
  });

  it('reports a false retention result instead of treating it as a successful update', async () => {
    const session = room({ onRetention: () => false });
    await session.raid(request());
    session.step(500_000);
    await expect(session.flush()).rejects.toThrow(/persist/i);
  });
});

describe('cancelled match starts', () => {
  it('never starts a practice match cancelled while content generation is pending', async () => {
    const began = deferred<void>();
    const content = deferred<unknown>();
    const session = room({
      generator: {
        generate: () => {
          began.resolve();
          return content.promise;
        },
      },
    });
    const starting = session.raid(request());
    await began.promise;
    session.reset();
    content.resolve({});
    await starting;
    expect(session.matchId).toBeUndefined();
    expect(session.view().status).toBe('idle');
  });

  it('cannot overwrite a newer match when an earlier cancelled start finally resolves', async () => {
    const began = deferred<void>();
    const content = deferred<unknown>();
    let calls = 0;
    const session = room({
      generator: {
        generate: async () => {
          calls += 1;
          if (calls === 1) {
            began.resolve();
            return content.promise;
          }
          return {};
        },
      },
    });
    const starting = session.raid(request());
    await began.promise;
    session.reset();
    await session.raid(request());
    const replacement = session.matchId;
    content.resolve({});
    await starting;
    expect(session.matchId).toBe(replacement);
  });

  it('selects the unconfigured Decionis adapter safely through its failure rules', async () => {
    const session = room({ gateKind: 'decionis' });
    const decision = await session.raid(request());
    expect(decision.verdict).toBe('ESCALATE');
    expect(session.view().status).toBe('pending');
  });
});
