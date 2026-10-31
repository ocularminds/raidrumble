import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { PolicyExecutor } from '../src/executor.js';
import { canonical } from '../src/decionis/shape.js';
import { request } from './helpers.js';
import { decisionId, dossierId, grantId, HostedFixture, json, object, orgId } from './hosted.js';

afterEach(() => vi.useRealTimers());

describe('hosted policy authorization', () => {
  it('sends the documented bound intent and preserves private remote authority', async () => {
    const wire = new HostedFixture();
    const { gate, logger } = wire.gate();
    const req = request();
    req.payload.raiderLogin = 'trusted';
    const decision = await gate.authorize(req);
    expect(decision).toMatchObject({
      verdict: 'ALLOW',
      source: 'decionis',
      decisionId,
      dossierId,
      grant: { id: grantId },
    });
    expect(wire.calls[0]).toMatchObject({
      path: '/v1/authority/grants',
      key: 'Bearer runtime.enforce.key',
    });
    const body = wire.calls[0]!.body;
    expect(body).toMatchObject({
      protocol_version: 'agent-safe.intent/1',
      tenant_id: orgId,
      mode: 'ENFORCEMENT',
      escalation: { mode: 'MANAGED' },
    });
    expect(object(body.action).type).toBe('rumble.start');
    expect(object(body.action).parameters).toMatchObject({
      channel: req.channel,
      payload: req.payload,
      matchId: 'match',
    });
    expect(object(body.context).idempotency_key).toBe(body.intent_id);
    expect(new Headers(wire.fetch.mock.calls[0]?.[1]?.headers).get('idempotency-key')).toBe(
      body.intent_id,
    );
    const serialized = JSON.stringify({
      decision,
      records: gate.listRecords(),
      logs: logger.mock.calls,
    });
    expect(serialized).not.toContain('private.execution.bearer');
    expect(serialized).not.toContain('runtime.enforce.key');
    expect(gate.listRecords()[0]).toMatchObject({ unsigned: false, dossierId });
  });

  it('does not ask hosted authority to override a host-local block or hold', async () => {
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const req = request();
    req.payload.raiderLogin = 'blocked';
    expect(await gate.authorize(req)).toMatchObject({ source: 'local', verdict: 'BLOCK' });
    req.payload.raiderLogin = 'visitor';
    expect(await gate.authorize(req)).toMatchObject({
      source: 'local',
      verdict: 'ESCALATE',
      reasonCodes: ['UNKNOWN_RAIDER'],
    });
    expect(wire.fetch).not.toHaveBeenCalled();
  });

  it('keeps ordinary shadow observations grant-free and uses the shadow credential', async () => {
    const wire = new HostedFixture();
    const { gate } = wire.gate('shadow');
    wire.handler = () => json(wire.decision('shadow', 'BLOCK'));
    const decision = await gate.authorize(request('ledger.settle'));
    expect(decision).toMatchObject({ source: 'decionis', verdict: 'BLOCK', mode: 'shadow' });
    expect(decision.grant).toBeUndefined();
    expect(wire.calls[0]?.key).toBe('Bearer runtime.shadow.key');
    expect(wire.calls[0]?.body.escalation).toBeUndefined();
    expect((await new PolicyExecutor(gate).execute(decision, () => 'observed')).executed).toBe(
      true,
    );
    expect(wire.fetch).toHaveBeenCalledOnce();
  });

  it('supports the canonical protocol route only for shadow evaluation', async () => {
    const wire = new HostedFixture();
    const { gate } = wire.gate('shadow', 'protocol');
    expect(await gate.authorize(request('ledger.settle'))).toMatchObject({
      source: 'decionis',
      decisionId,
      dossierId,
      mode: 'shadow',
    });
    expect(wire.calls[0]?.body).toMatchObject({
      decision_type: 'ledger.settle',
      org_id: orgId,
      mode: 'SHADOW',
    });
    gate.setMode('content.render', 'enforce');
    const req = request('content.render');
    req.payload = { text: 'Arena ready' };
    await gate.authorize(req);
    expect(wire.calls[1]?.path).toBe('/v1/authority/grants');
  });

  it.each([
    'wrong hash',
    'missing grant',
    'wrong mode',
    'expired grant',
    'non-authoritative',
    'malformed JSON',
  ])('fails closed on %s', async (fault) => {
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    wire.handler = () => {
      const result = wire.decision();
      if (fault === 'wrong hash') result.action_hash = `sha256:${'0'.repeat(64)}`;
      if (fault === 'missing grant') result.execution_token = null;
      if (fault === 'wrong mode') result.mode = 'SHADOW';
      if (fault === 'expired grant')
        result.execution_token_expires_at = new Date(wire.time).toISOString();
      if (fault === 'non-authoritative') result.authority_classification = 'OBSERVATIONAL';
      return fault === 'malformed JSON' ? new Response('{') : json(result);
    };
    const req = request('chat.send');
    req.payload = { text: 'Welcome', templated: true };
    const decision = await gate.authorize(req);
    expect(decision).toMatchObject({
      source: 'local',
      verdict: 'BLOCK',
      reasonCodes: expect.arrayContaining(['POLICY_ERROR', 'MESSAGE_SKIPPED']),
    });
    expect(decision.dossierId).toBeUndefined();
    expect((await new PolicyExecutor(gate).execute(decision, vi.fn())).executed).toBe(false);
  });

  it('aborts at 1500ms, discards late authority, and keeps a shadow start held', async () => {
    vi.useFakeTimers();
    const wire = new HostedFixture();
    const { gate } = wire.gate('shadow');
    let finish: ((response: Response) => void) | undefined;
    wire.handler = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const req = request();
    req.payload.raiderLogin = 'trusted';
    const pending = gate.authorize(req);
    await vi.advanceTimersByTimeAsync(1500);
    const decision = await pending;
    expect(decision).toMatchObject({
      source: 'local',
      verdict: 'ESCALATE',
      reasonCodes: ['POLICY_TIMEOUT'],
    });
    expect(wire.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    finish?.(json(wire.decision('shadow')));
    await Promise.resolve();
    expect((await new PolicyExecutor(gate).execute(decision, vi.fn())).executed).toBe(false);
    expect(gate.listRecords()).toHaveLength(1);
  });

  it('only the declared unsigned ledger fallback executes after transport failure', async () => {
    const wire = new HostedFixture();
    const { gate } = wire.gate('shadow');
    wire.handler = () => {
      throw new Error('offline');
    };
    const decision = await gate.authorize(request('ledger.settle'));
    expect(decision).toMatchObject({
      source: 'local',
      verdict: 'ALLOW',
      reasonCodes: ['POLICY_ERROR', 'UNSIGNED_LEDGER_FALLBACK'],
    });
    expect((await new PolicyExecutor(gate).execute(decision, () => 1)).executed).toBe(true);
  });

  // Expected bytes and digests are from AgentSafe's conformance/vectors fixtures.
  it.each([
    {
      name: 'negative zero',
      input: { amount: -0 },
      expected: '{"amount":0}',
      digest: 'e6a312b1d452aa705e11d045f19ba9f7097fbbc3a7ef956573c98e6d81203b6a',
    },
    {
      name: 'UTF-16 key order',
      input: { Éclair: 4, zé: 1, za: 2, Z: 3 },
      expected: '{"Z":3,"za":2,"zé":1,"Éclair":4}',
      digest: '87fb08703bfcfc2249c4aa2ed144c53b900de74f7bedb432ea690e0b5388f3fa',
    },
    {
      name: 'fractional and exponent numbers',
      input: { rate: 1.5, big: 1e21 },
      expected: '{"big":1e+21,"rate":1.5}',
      digest: '2bf2414e38ed0efe498fa735f624fd758adf2a647b1a14b1208e0734976849f8',
    },
  ])('matches the published $name conformance vector', ({ input, expected, digest }) => {
    const serialized = canonical(input);
    expect(serialized).toBe(expected);
    expect(createHash('sha256').update(serialized).digest('hex')).toBe(digest);
  });
});
