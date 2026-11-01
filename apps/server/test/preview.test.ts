import { expect, it, vi } from 'vitest';
import { demoChannels } from '@raidrumble/content';
import { Ledger } from '@raidrumble/ledger';
import { Rooms } from '../src/services/rooms.js';
import { SettingsStore } from '../src/services/settings.js';

it('keeps anonymous previews off paid generation while retaining it for connected hosts', async () => {
  const ledger = new Ledger(':memory:');
  const generate = vi.fn(async () => ({}));
  const rooms = new Rooms({
    ledger,
    settings: new SettingsStore(),
    generator: { generate },
    quiet: true,
  });
  try {
    await rooms.demo('normal');
    rooms.get('demo').reset();
    await rooms.demo('hate-raid');
    expect(generate).not.toHaveBeenCalled();

    const host = { ...demoChannels.host, id: 'connected' };
    rooms.addHost(host);
    await rooms.raid(host.id, {
      channels: { ...demoChannels, host },
      raiderLogin: 'pixelpilot',
      accountAgeDays: 300,
      hostFollowsRaider: true,
      viewers: 30,
    });
    expect(generate).toHaveBeenCalledOnce();
  } finally {
    await rooms.close();
    ledger.close();
  }
});

it('keeps hosted preview outcomes out of persistent channel records', async () => {
  const ledger = new Ledger(':memory:');
  const settle = vi.spyOn(ledger, 'settle');
  const rooms = new Rooms({
    ledger,
    settings: new SettingsStore(),
    ephemeralDemo: true,
    quiet: true,
  });
  try {
    await rooms.demo('normal');
    for (let second = 0; second < 190; second += 1) {
      rooms.step(1000);
      await rooms.flush();
    }
    expect(rooms.get('demo').view().match?.status).toBe('finished');
    expect(settle).not.toHaveBeenCalled();
    expect(ledger.graph().edges).toEqual([]);
  } finally {
    await rooms.close();
    ledger.close();
  }
});
