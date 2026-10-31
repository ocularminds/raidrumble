import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

describe('host API and real match integration', () => {
  let runtime: Awaited<ReturnType<typeof createApp>>;
  let now = 0;
  beforeEach(async () => {
    now = 0;
    runtime = await createApp({ autoTick: false, quiet: true, openai: false, now: () => now });
    await runtime.app.ready();
  });
  afterEach(async () => {
    await runtime.app.close();
  });

  it('starts the actual three-round registry for an allowed local raid', async () => {
    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/demo',
      payload: { scenario: 'normal' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'active',
      simulated: true,
      decision: { verdict: 'ALLOW' },
      match: { round: { id: 'siege' } },
    });
    for (let tick = 0; tick < 1800; tick++) runtime.rooms.step(100);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const state = await runtime.app.inject('/api/arena/demo');
    expect(state.json().match).toMatchObject({
      status: 'finished',
      degraded: false,
      winner: 'both',
    });
    expect(runtime.ledger.pair('demo', 'pixel')?.matches).toBe(1);
  });

  it('holds strangers for exactly one host decision and rejects its replay', async () => {
    const raid = await runtime.app.inject({
      method: 'POST',
      url: '/api/demo',
      payload: { scenario: 'stranger-raid' },
    });
    const view = raid.json();
    expect(view).toMatchObject({ status: 'pending', decision: { verdict: 'ESCALATE' } });
    expect(view.match).toBeUndefined();
    const request = {
      method: 'POST' as const,
      url: '/api/approve/demo',
      payload: { decisionId: view.pending.decisionId },
    };
    expect((await runtime.app.inject(request)).statusCode).toBe(200);
    expect((await runtime.app.inject(request)).statusCode).toBe(409);
  });

  it('reports a hosted hold as pending and keeps approval details off the public overlay', async () => {
    const room = await runtime.rooms.demo('stranger-raid');
    const decisionId = room.view().pending!.decisionId;
    const held = room.gate.getDecision(decisionId)!;
    vi.spyOn(room.gate, 'approve').mockResolvedValue({
      ...held,
      source: 'decionis',
      approval: { url: 'https://approval.example/request/held', expiresAt: 9000 },
      grant: { id: 'private-grant', expiresAt: 9000 },
    });
    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/approve/demo',
      payload: { decisionId },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      accepted: false,
      pending: { decisionId, expiresAt: 10000 },
    });
    const overlay = (await runtime.app.inject('/api/arena/demo')).json();
    expect(overlay.decision).not.toHaveProperty('approval');
    expect(overlay.decision).not.toHaveProperty('grant');
    const dashboard = (await runtime.app.inject('/api/status/demo')).json();
    expect(dashboard.approval).toEqual({
      source: 'decionis',
      url: 'https://approval.example/request/held',
      expiresAt: 9000,
    });
    now = 10000;
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/approve/demo',
          payload: { decisionId },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('demonstrates ESCALATE again after an earlier stranger simulation is settled', async () => {
    const room = runtime.rooms.get('demo');
    const identities: string[] = [];
    for (let run = 0; run < 2; run += 1) {
      const response = await runtime.app.inject({
        method: 'POST',
        url: '/api/demo',
        payload: { scenario: 'stranger-raid', speed: 2 },
      });
      const view = response.json();
      expect(view).toMatchObject({
        status: 'pending',
        decision: { verdict: 'ESCALATE', reasonCodes: ['UNKNOWN_RAIDER'] },
      });
      const raiderId = room.gate.getRequest(view.decision.decisionId)?.channel.raiderId;
      expect(raiderId).toBeDefined();
      identities.push(raiderId!);
      expect(
        (
          await runtime.app.inject({
            method: 'POST',
            url: '/api/approve/demo',
            payload: { decisionId: view.pending.decisionId },
          })
        ).statusCode,
      ).toBe(200);
      room.step(180_000);
      await room.flush();
      expect(runtime.ledger.pair('demo', raiderId!)?.matches).toBe(1);
    }
    expect(new Set(identities).size).toBe(2);
  });

  it('preserves friendly rematches and their normal ledger-based trust', async () => {
    const room = await runtime.rooms.demo('normal');
    room.step(180_000);
    await room.flush();
    room.configure({ ...room.settings(), allow: [] });
    await runtime.rooms.demo('normal');
    expect(room.raiderId).toBe('pixel');
    expect(room.view()).toMatchObject({
      status: 'active',
      rematch: expect.stringContaining('REMATCH'),
      decision: { verdict: 'ALLOW', reasonCodes: ['KNOWN_RIVAL'] },
    });
    room.step(180_000);
    await room.flush();
    expect(runtime.ledger.pair('demo', 'pixel')?.matches).toBe(2);
  });

  it('expires unanswered challenges without starting a match', async () => {
    const raid = await runtime.app.inject({
      method: 'POST',
      url: '/api/demo',
      payload: { scenario: 'stranger-raid' },
    });
    const decisionId = raid.json().pending.decisionId;
    now = 10001;
    runtime.rooms.step(1);
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/approve/demo',
          payload: { decisionId },
        })
      ).statusCode,
    ).toBe(409);
    expect(runtime.rooms.get('demo').view().status).toBe('idle');
  });

  it('blocks an unwelcome raid without showing a match', async () => {
    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/demo',
      payload: { scenario: 'hate-raid' },
    });
    expect(response.json()).toMatchObject({ status: 'idle', decision: { verdict: 'BLOCK' } });
    expect(response.json().match).toBeUndefined();
  });

  it('accepts an actual host-inclusive Shared Chat session', async () => {
    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/demo',
      payload: { scenario: 'collab' },
    });
    expect(response.json()).toMatchObject({ status: 'active', decision: { verdict: 'ALLOW' } });
  });

  it('rejects cross-origin mutations and unauthenticated live host controls', async () => {
    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/demo',
      headers: { origin: 'https://untrusted.example' },
      payload: { scenario: 'normal' },
    });
    expect(response.statusCode).toBe(403);
    expect(
      (await runtime.app.inject({ method: 'POST', url: '/api/oil/1234', payload: {} })).statusCode,
    ).toBe(401);
    expect((await runtime.app.inject('/api/status/1234')).statusCode).toBe(401);
  });

  it('validates the control payload rather than trusting caller actor or mode fields', async () => {
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/settings/demo',
          payload: { mode: 'disable' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/demo',
          payload: { scenario: 'invalid' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/demo',
          payload: { scenario: 'normal', speed: -1 },
        })
      ).statusCode,
    ).toBe(400);
  });
});
