import { afterEach, describe, expect, it } from 'vitest';
import { Ledger, RegularStore } from '@raidrumble/ledger';
import { demoChannels } from '@raidrumble/content';
import { Rooms } from '../src/services/rooms.js';
import { SettingsStore } from '../src/services/settings.js';
import type { RaidRequest } from '../src/services/room.js';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function fixture() {
  let now = 1_000;
  const ledger = new Ledger();
  const regulars = new RegularStore();
  cleanup.push(() => ledger.close());
  const rooms = new Rooms({
    ledger,
    regulars,
    settings: new SettingsStore(),
    now: () => now,
    quiet: true,
  });
  cleanup.push(() => rooms.close());
  const request: RaidRequest = {
    channels: demoChannels,
    raiderLogin: 'pixelpilot',
    accountAgeDays: 300,
    hostFollowsRaider: true,
    viewers: 300,
    occurredAt: 2_000,
  };
  return {
    rooms,
    regulars,
    request,
    room: rooms.get('demo'),
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe('live host attribution evidence', () => {
  it('derives live home size from recent pre-raid chatters instead of inventing twenty', async () => {
    const { rooms, room, request, setNow } = fixture();
    for (let index = 0; index < 12; index += 1) {
      await room.chat({ userId: `home${index}`, text: 'before', occurredAt: 1_000 });
    }
    setNow(2_000);
    await rooms.raid('demo', request);
    expect(room.view().match?.teams.home).toBe(12);
  });

  it('keeps the earlier pre-raid timestamp when delivery is reordered inside one sample window', async () => {
    const { rooms, room, request, setNow } = fixture();
    setNow(3_000);
    for (let index = 0; index < 6; index += 1) {
      await room.chat({ userId: `home${index}`, text: 'later', occurredAt: 2_600 });
      await room.chat({ userId: `home${index}`, text: 'earlier', occurredAt: 2_400 });
    }
    await rooms.raid('demo', { ...request, occurredAt: 2_500 });
    expect(room.view().match?.teams.home).toBe(6);
  });

  it('remembers pre-raid Home Guard messages and distinguishes new incoming chatters', async () => {
    const { rooms, room, request, setNow } = fixture();
    await room.chat({ userId: 'homeViewer', text: 'hello before the raid', occurredAt: 1_000 });
    setNow(2_000);
    await rooms.raid('demo', request);
    setNow(2_100);
    room.step(100);
    const text = room.view().match!.round!.keyword;
    await room.chat({ userId: 'homeViewer', text, occurredAt: 2_100 });
    await room.chat({ userId: 'newViewer', text, occurredAt: 2_100 });
    expect(room.assignment('homeViewer')?.team).toBe('home');
    expect(room.assignment('newViewer')?.team).toBe('raiders');
    expect(JSON.stringify(room.view())).not.toContain('hello before the raid');
  });

  it('uses prior-stream regular hashes for viewers whose first current message arrives after a raid', async () => {
    const { rooms, room, regulars, request, setNow } = fixture();
    regulars.beginStream('demo', 'previous');
    regulars.observe('demo', 'regularViewer');
    rooms.beginStream('demo', 'current');
    setNow(2_000);
    await rooms.raid('demo', request);
    setNow(2_100);
    room.step(100);
    await room.chat({
      userId: 'regularViewer',
      text: room.view().match!.round!.keyword,
      occurredAt: 2_100,
    });
    expect(room.assignment('regularViewer')?.team).toBe('home');
  });

  it('maps the raid event time rather than content-generation completion time', async () => {
    const { rooms, room, request, setNow } = fixture();
    setNow(2_500);
    await room.chat({
      userId: 'visitor',
      text: 'arrived during the accept prompt',
      occurredAt: 2_500,
    });
    setNow(3_000);
    await rooms.raid('demo', request);
    await room.chat({
      userId: 'visitor',
      text: room.view().match!.round!.keyword,
      occurredAt: 3_000,
    });
    expect(room.assignment('visitor')?.team).toBe('raiders');
  });

  it('feeds roster evidence into Game and releases the capture after completion', async () => {
    const { rooms, room, request, setNow } = fixture();
    let released = 0;
    setNow(2_000);
    await rooms.raid('demo', {
      ...request,
      roster: new Set(['captured']),
      onComplete: () => {
        released += 1;
      },
    });
    await room.chat({
      userId: 'captured',
      text: room.view().match!.round!.keyword,
      occurredAt: 2_000,
    });
    expect(room.assignment('captured')?.source).toBe('roster');
    room.step(180_000);
    await room.flush();
    expect(released).toBe(1);
    expect(room.assignment('captured')).toBeUndefined();
    room.step(300_000);
    await room.flush();
    expect(JSON.stringify(room.view())).not.toContain('captured');
  });
});
