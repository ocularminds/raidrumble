import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveOptions } from '../src/live/model.js';
import { createApp } from '../src/app.js';

const callbacks = vi.hoisted(() => ({ redemption: undefined as LiveOptions['onRedemption'] }));

vi.mock('../src/live/index.js', async (original) => {
  const module = await original<typeof import('../src/live/index.js')>();
  return {
    ...module,
    LiveService: class {
      constructor(options: LiveOptions) {
        callbacks.redemption = options.onRedemption;
      }
      async register(): Promise<void> {}
      async stop(): Promise<void> {}
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('application redemption routing during isolated practice', () => {
  it('keeps real reward events on the primary room and never reinforces the practice team', async () => {
    vi.stubEnv('POLICY_GATE', 'local');
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected network call'));
    vi.stubGlobal('fetch', network);
    const runtime = await createApp({ quiet: true, autoTick: false, openai: false });
    try {
      await runtime.app.ready();
      const host = {
        id: 'host',
        name: 'Host',
        category: 'Art',
        title: 'Drawing together',
        tags: [],
        facts: [],
      };
      runtime.rooms.addHost(host);
      runtime.rooms.rewardIds.set(host.id, 'reward');
      const primary = runtime.rooms.primary(host.id);
      const practice = await runtime.rooms.practice(host.id);
      const liveReinforce = vi.spyOn(primary, 'reinforce');
      const practiceReinforce = vi.spyOn(practice, 'reinforce');
      const event = {
        type: 'redemption' as const,
        id: 'event',
        occurredAt: 0,
        channelId: host.id,
        userId: 'viewer',
        rewardId: 'reward',
        redemptionId: 'one',
        status: 'fulfilled',
      };
      expect(callbacks.redemption).toBeDefined();
      await callbacks.redemption!(host.id, event);
      expect(liveReinforce).toHaveBeenCalledWith(
        {
          userId: 'viewer',
          rewardId: 'reward',
          redemptionId: 'one',
          status: 'fulfilled',
        },
        'reward',
      );
      expect(practiceReinforce).not.toHaveBeenCalled();
      expect(practice.specialBudgets?.reinforcedUsers).toBe(0);
      expect(
        practice.gate.listRecords().filter((record) => record.action === 'special.fire'),
      ).toEqual([]);

      await runtime.rooms.raid(host.id, {
        channels: { host, raider: { ...host, id: 'raider', name: 'Raider' } },
        raiderLogin: 'raider',
        accountAgeDays: 30,
        hostFollowsRaider: true,
        viewers: 5,
      });
      await callbacks.redemption!(host.id, { ...event, id: 'next', redemptionId: 'two' });
      expect(primary.specialBudgets?.reinforcedUsers).toBe(1);
      expect(practiceReinforce).not.toHaveBeenCalled();
      expect(runtime.ledger.graph().edges).toEqual([]);
      expect(network).not.toHaveBeenCalled();
    } finally {
      await runtime.app.close();
    }
  });
});
