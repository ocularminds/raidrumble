import { describe, expect, it } from 'vitest';
import { PolicyExecutor } from '../src/executor.js';
import { request } from './helpers.js';
import { escalationId, HostedFixture, json } from './hosted.js';

describe('local prerequisite and hosted approval', () => {
  it('uses a host click only for the local prerequisite and still asks hosted authority', async () => {
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const decision = await gate.authorize(request());
    await expect(gate.approve(decision.decisionId, 'stranger')).rejects.toThrow('approver');
    expect(wire.fetch).not.toHaveBeenCalled();
    const approved = await gate.approve(decision.decisionId, 'host');
    expect(approved).toMatchObject({ verdict: 'ALLOW', source: 'decionis' });
    expect(approved.decisionId).not.toBe(decision.decisionId);
    expect(wire.calls[0]?.body.evidence).toBeUndefined();
    expect((await new PolicyExecutor(gate).execute(decision, () => 1)).executed).toBe(false);
  });

  it('keeps the original host deadline when host approval starts hosted evaluation', async () => {
    const wire = new HostedFixture();
    const started = wire.time;
    const { gate } = wire.gate();
    const decision = await gate.authorize(request());
    wire.time += 9_000;
    const approved = await gate.approve(decision.decisionId, 'host');
    expect(approved.grant?.expiresAt).toBe(started + 10_000);
    wire.time = started + 10_000;
    expect(await gate.claimGrant(approved.grant!.id)).toBe(false);
  });

  it('cannot turn a hosted hold into a local approval, including on status errors', async () => {
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    wire.handler = (path) =>
      path === '/v1/authority/grants' ? json(wire.hold()) : json(wire.status());
    const req = request();
    req.payload.raiderLogin = 'trusted';
    const held = await gate.authorize(req);
    expect(held).toMatchObject({ source: 'decionis', verdict: 'ESCALATE' });
    expect(held.grant).toBeUndefined();
    expect(held.approval).toBeUndefined();
    const pending = await gate.approve(held.decisionId, 'host');
    expect(pending.verdict).toBe('ESCALATE');
    expect(wire.calls.at(-1)?.path).toBe(`/v1/authority/escalations/${escalationId}`);
    wire.handler = () => {
      throw new Error('status unavailable');
    };
    await expect(gate.approve(held.decisionId, 'host')).rejects.toThrow();
    expect(gate.getDecision(held.decisionId)?.grant).toBeUndefined();
    expect((await new PolicyExecutor(gate).execute(held, () => 1)).executed).toBe(false);
  });

  it('accepts only a matching GRANT_READY status and consumes the held decision', async () => {
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    wire.handler = (path) =>
      path === '/v1/authority/grants' ? json(wire.hold()) : json(wire.status('GRANT_READY'));
    const req = request();
    req.payload.raiderLogin = 'trusted';
    const held = await gate.authorize(req);
    const approved = await gate.approve(held.decisionId, 'host');
    expect(approved).toMatchObject({
      source: 'decionis',
      verdict: 'ALLOW',
      decisionId: 'ready.decision',
    });
    expect(approved.grant).toBeDefined();
    await expect(gate.approve(held.decisionId, 'host')).rejects.toThrow();
  });

  it.each(['changed intent', 'changed expiry', 'pending grant', 'no grant'])(
    'rejects managed %s',
    async (fault) => {
      const wire = new HostedFixture();
      const { gate } = wire.gate();
      wire.handler = (path) => {
        if (path === '/v1/authority/grants') return json(wire.hold());
        const status = wire.status('GRANT_READY');
        if (fault === 'changed intent') status.intent_id = 'different.intent';
        if (fault === 'changed expiry')
          status.expires_at = new Date(wire.time + 20_000).toISOString();
        if (fault === 'pending grant') {
          status.status = 'AWAITING_APPROVER';
          status.outcome = 'ESCALATE_PENDING';
        }
        if (fault === 'no grant') status.decision = null;
        return json(status);
      };
      const req = request();
      req.payload.raiderLogin = 'trusted';
      const held = await gate.authorize(req);
      await expect(gate.approve(held.decisionId, 'host')).rejects.toThrow();
      expect(gate.getDecision(held.decisionId)?.grant).toBeUndefined();
    },
  );

  it('does not revive a hold after the original ten seconds', async () => {
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    wire.handler = () => json(wire.hold());
    const req = request();
    req.payload.raiderLogin = 'trusted';
    const held = await gate.authorize(req);
    wire.time += 10_000;
    await expect(gate.approve(held.decisionId, 'host')).rejects.toThrow('expired');
    expect(wire.fetch).toHaveBeenCalledOnce();
  });
});
