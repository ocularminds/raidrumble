import { describe, expect, it, vi } from 'vitest';
import { demoChannels } from '@raidrumble/content';
import { defaultPolicy } from '@raidrumble/policy';
import { Room, type RaidRequest } from '../src/services/room.js';

function raid(): RaidRequest {
  return {
    channels: {
      ...structuredClone(demoChannels),
      raider: { ...demoChannels.raider, name: 'NewChallenger' },
    },
    raiderLogin: 'newchallenger',
    accountAgeDays: 30,
    hostFollowsRaider: false,
    viewers: 42,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('incoming raid presentation and approval safety', () => {
  it('shows an executed match immediately while its executor finishes receipt work', async () => {
    const room = new Room({ hostId: 'demo', config: defaultPolicy(), quiet: true });
    const executed = deferred();
    const receipt = deferred();
    const execute = room.executor.execute.bind(room.executor);
    vi.spyOn(room.executor, 'execute').mockImplementation(async (decision, effect) => {
      const result = await execute(decision, effect);
      executed.resolve();
      await receipt.promise;
      return result;
    });
    const request = raid();
    request.hostFollowsRaider = true;
    const starting = room.raid(request);
    await executed.promise;
    expect(room.view()).toMatchObject({ status: 'active', match: { status: 'playing' } });
    expect(room.view().incoming).toBeUndefined();
    receipt.resolve();
    await starting;
    await room.close();
  });

  it('shows incoming immediately, then exposes the exact gated pending name and facts', async () => {
    let now = 1000;
    const config = defaultPolicy();
    config.defaults.mode = 'enforce';
    const room = new Room({ hostId: 'demo', config, quiet: true, now: () => now });
    const release = deferred();
    const authorize = room.gate.authorize.bind(room.gate);
    vi.spyOn(room.gate, 'authorize').mockImplementation(async (request) => {
      if (request.action === 'rumble.start') await release.promise;
      return authorize(request);
    });
    const request = raid();
    const starting = room.raid(request);
    expect(room.view()).toMatchObject({ status: 'incoming', incoming: { expiresAt: 2500 } });
    request.channels.raider.name = 'Changed after capture';
    request.raiderLogin = 'different';
    request.viewers = 999;
    now += 500;
    release.resolve();
    const decision = await starting;
    expect(room.view()).toMatchObject({
      status: 'pending',
      raiderName: 'NewChallenger',
      pending: {
        decisionId: decision.decisionId,
        expiresAt: 11000,
        raiderLogin: 'newchallenger',
        viewers: 42,
      },
    });
    expect(room.view().incoming).toBeUndefined();
    await room.close();
  });

  it('gates idle and pending channel names and never exposes a blocked raw display name', async () => {
    const config = defaultPolicy();
    config.defaults.mode = 'enforce';
    config.lists.blockedTerms = ['forbidden'];
    const room = new Room({ hostId: 'demo', config, quiet: true });
    await room.nameHost('Mossy');
    expect(room.view().hostName).toBe('Mossy');
    const request = raid();
    request.channels.raider.name = 'Forbidden visitor';
    await room.raid(request);
    expect(room.view().raiderName).toBe('Raiders');
    expect(JSON.stringify(room.view())).not.toContain('Forbidden visitor');
    await room.close();
  });

  it('discards incoming state and late authorization after a reset', async () => {
    const room = new Room({ hostId: 'demo', config: defaultPolicy(), quiet: true });
    const release = deferred();
    const authorize = room.gate.authorize.bind(room.gate);
    vi.spyOn(room.gate, 'authorize').mockImplementation(async (request) => {
      if (request.action === 'rumble.start') await release.promise;
      return authorize(request);
    });
    const starting = room.raid(raid());
    expect(room.view().status).toBe('incoming');
    room.reset();
    release.resolve();
    await starting;
    expect(room.view()).toMatchObject({ status: 'idle' });
    expect(room.view().incoming).toBeUndefined();
    expect(room.view().match).toBeUndefined();
    await room.close();
  });

  it('does not start or trust when content preparation crosses the approval deadline', async () => {
    let now = 1000;
    const config = defaultPolicy();
    config.defaults.mode = 'enforce';
    const begun = deferred();
    const release = deferred();
    const room = new Room({
      hostId: 'demo',
      config,
      quiet: true,
      now: () => now,
      generator: {
        generate: async () => {
          begun.resolve();
          await release.promise;
          return {};
        },
      },
    });
    const decision = await room.raid(raid());
    const approval = room.approve(decision.decisionId, 'demo', true);
    await begun.promise;
    now += 10001;
    release.resolve();
    expect(await approval).toBe(false);
    expect(room.view().match).toBeUndefined();
    expect(room.settings().allow).not.toContain('newchallenger');
    await room.close();
  });
});
