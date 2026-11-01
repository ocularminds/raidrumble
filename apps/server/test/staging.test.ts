import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoChannels, safeContent } from '@raidrumble/content';
import { defaultPolicy } from '@raidrumble/policy';
import { decisionBook } from '../../../packages/policy/src/receipts.js';
import { HostedFixture, json, object, orgId } from '../../../packages/policy/test/hosted.js';
import { Room, type RaidRequest } from '../src/services/room.js';

afterEach(() => vi.useRealTimers());

function request(): RaidRequest {
  return {
    channels: structuredClone(demoChannels),
    raiderLogin: 'challenger',
    accountAgeDays: 30,
    hostFollowsRaider: false,
    viewers: 30,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('prepared starts and execution leases', () => {
  it('starts an initial hosted ALLOW with authored content while a slow generator finishes', async () => {
    vi.useFakeTimers();
    const wire = new HostedFixture();
    let generated = false;
    const config = defaultPolicy();
    config.defaults.mode = 'enforce';
    config.lists.allow = ['challenger'];
    wire.handler = (path, body) =>
      path.endsWith('/receipts')
        ? wire.respond(path, body)
        : new Promise((resolve) =>
            setTimeout(
              () => resolve(wire.respond(path, body)),
              path.endsWith('/claims') ? 500 : 700,
            ),
          );
    const room = new Room({
      hostId: 'demo',
      config,
      quiet: true,
      gateKind: 'decionis',
      now: () => wire.time,
      decionis: {
        apiKey: 'test.runtime',
        orgId,
        fetch: async (input, init) => {
          if (new URL(String(input)).pathname === '/v1/authority/grants') {
            const body = object(JSON.parse(String(init?.body)));
            if (object(body.action).type === 'content.render') return json({}, 503);
          }
          return wire.fetch(input, init);
        },
      },
      generator: {
        generate: () =>
          new Promise((resolve) =>
            setTimeout(() => {
              generated = true;
              resolve({
                boss: { name: 'Late generated boss', flavour: 'Must never replace the match.' },
              });
            }, 2000),
          ),
      },
    });
    const starting = room.raid(request());
    wire.time += 700;
    await vi.advanceTimersByTimeAsync(700);
    wire.time += 500;
    await vi.advanceTimersByTimeAsync(500);
    expect(room.view()).toMatchObject({ status: 'active', match: { status: 'playing' } });
    expect(await starting).toMatchObject({ verdict: 'ALLOW', source: 'decionis' });
    expect(generated).toBe(false);
    expect(wire.calls.map((call) => call.path)).toHaveLength(3);
    wire.time += 800;
    await vi.advanceTimersByTimeAsync(800);
    expect(generated).toBe(true);
    room.step(110000);
    expect(room.view().match?.round?.boss?.name).toBe(safeContent().boss.name);
    expect(room.view().pending).toBeUndefined();
    await room.close();
  });

  it('prepares all content before claiming the short execution lease', async () => {
    let now = 0;
    const order: string[] = [];
    const config = defaultPolicy();
    config.defaults.mode = 'enforce';
    const room = new Room({
      hostId: 'host',
      config,
      quiet: true,
      now: () => now,
      generator: {
        generate: async () => {
          order.push('prepare');
          now += 100;
          return {};
        },
      },
    });
    const held = await room.raid(request());
    const claim = room.gate.claimGrant.bind(room.gate);
    vi.spyOn(room.gate, 'claimGrant').mockImplementation(async (id) => {
      const claimed = await claim(id);
      order.push('claim');
      if (claimed) decisionBook(room.gate)!.limitExecution(held.decisionId, now + 50);
      return claimed;
    });
    expect(await room.approve(held.decisionId, 'host', true)).toBe(true);
    expect(room.view().match?.status).toBe('playing');
    expect(order).toEqual(['prepare', 'claim']);
    expect(decisionBook(room.gate)!.executionBudget(held.decisionId)).toBe(50);
    expect(room.settings().allow).toContain('challenger');
    await room.close();
  });

  it('keeps a timely start accepted if only receipt finalization crosses the lease', async () => {
    let now = 0;
    let dispatchBudget: number | undefined;
    const config = defaultPolicy();
    config.defaults.mode = 'enforce';
    const room = new Room({
      hostId: 'host',
      config,
      quiet: true,
      now: () => now,
      generator: {
        generate: async () => {
          now += 100;
          return {};
        },
      },
    });
    const held = await room.raid(request());
    const claim = room.gate.claimGrant.bind(room.gate);
    vi.spyOn(room.gate, 'claimGrant').mockImplementation(async (id) => {
      const claimed = await claim(id);
      if (claimed) decisionBook(room.gate)!.limitExecution(held.decisionId, now + 50);
      return claimed;
    });
    const finalize = vi.fn(async () => {
      expect(room.view().match?.status).toBe('playing');
      dispatchBudget = decisionBook(room.gate)!.executionBudget(held.decisionId);
      now += 100;
      return false;
    });
    room.gate.finalizeGrant = finalize;
    expect(await room.approve(held.decisionId, 'host', true)).toBe(true);
    expect(dispatchBudget).toBe(50);
    expect(finalize).toHaveBeenCalledWith(expect.any(String), 'COMMITTED');
    expect(room.settings().allow).toContain('challenger');
    expect(await room.approve(held.decisionId, 'host', true)).toBe(false);
    expect(finalize).toHaveBeenCalledOnce();
    await room.close();
  });

  it('never requests approval or claims after a host cancels unfinished preparation', async () => {
    const begun = deferred();
    const release = deferred();
    const config = defaultPolicy();
    config.defaults.mode = 'enforce';
    const room = new Room({
      hostId: 'host',
      config,
      quiet: true,
      generator: {
        generate: async () => {
          begun.resolve();
          await release.promise;
          return {};
        },
      },
    });
    const held = await room.raid(request());
    const approve = vi.spyOn(room.gate, 'approve');
    const claim = vi.spyOn(room.gate, 'claimGrant');
    const accepting = room.approve(held.decisionId, 'host', true);
    await begun.promise;
    room.decline();
    release.resolve();
    expect(await accepting).toBe(false);
    expect(approve).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(room.view().match).toBeUndefined();
    expect(room.settings().allow).toEqual([]);
    await room.close();
  });
});
