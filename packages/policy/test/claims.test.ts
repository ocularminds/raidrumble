import { afterEach, describe, expect, it, vi } from 'vitest';
import { PolicyExecutor } from '../src/executor.js';
import type { HelixWrite } from '../src/models.js';
import { request } from './helpers.js';
import { grantId, HostedFixture, json, object } from './hosted.js';

afterEach(() => vi.useRealTimers());

describe('hosted claim and receipt boundary', () => {
  it('claims once before the effect and records COMMITTED after it', async () => {
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const decision = await gate.authorize(request('ledger.settle'));
    const effect = vi.fn(() => {
      expect(wire.calls.at(-1)?.path).toBe(`/v1/authority/grants/${grantId}/claims`);
      return 'committed';
    });
    const executor = new PolicyExecutor(gate);
    const results = await Promise.all([
      executor.execute(decision, effect),
      executor.execute(decision, effect),
    ]);
    expect(results.filter((result) => result.executed)).toEqual([
      { executed: true, value: 'committed' },
    ]);
    expect(effect).toHaveBeenCalledOnce();
    expect(wire.calls.map((call) => call.path)).toEqual([
      '/v1/authority/grants',
      `/v1/authority/grants/${grantId}/claims`,
      `/v1/authority/grants/${grantId}/receipts`,
    ]);
    expect(wire.calls[1]?.body).toMatchObject({
      intent: wire.intent,
      intent_hash: wire.hash,
      execution_token: 'private.execution.bearer',
      commit_correlation_id: wire.intent.intent_id,
    });
    expect(wire.calls[2]?.body).toMatchObject({
      execution_token: 'private.execution.bearer',
      claim_token: 'c'.repeat(43),
      outcome: 'COMMITTED',
      commit_correlation_id: wire.intent.intent_id,
    });
    expect(wire.calls.every((call) => call.key === 'Bearer runtime.enforce.key')).toBe(true);
    expect(await gate.claimGrant(grantId)).toBe(false);
    expect(JSON.stringify(gate.listRecords())).not.toContain('private.execution.bearer');
    expect(JSON.stringify(gate.listRecords())).not.toContain('c'.repeat(43));
  });

  it.each([
    'claim rejected',
    'wrong host',
    'wrong intent',
    'wrong decision',
    'wrong dossier',
    'expired lease',
    'missing lease',
    'missing token',
    'wrong payload digest',
  ])('does not dispatch after %s', async (fault) => {
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    wire.handler = (path, body) => {
      if (!path.endsWith('/claims')) return wire.respond(path, body);
      const claim = wire.claim();
      if (fault === 'claim rejected') return json({ valid: false, should_execute: false }, 409);
      if (fault === 'wrong host') object(claim.claims).org_id = 'another.tenant';
      if (fault === 'wrong intent')
        object(object(claim.claims).binding).intent_hash = `sha256:${'f'.repeat(64)}`;
      if (fault === 'wrong decision') object(claim.claims).decision_id = 'another.decision';
      if (fault === 'wrong dossier') object(claim.claims).dossier_id = 'another.dossier';
      if (fault === 'expired lease')
        claim.claim_lease_expires_at = new Date(wire.time).toISOString();
      if (fault === 'missing lease') delete claim.claim_lease_expires_at;
      if (fault === 'missing token') claim.claim_token = null;
      if (fault === 'wrong payload digest') {
        object(object(claim.claims).binding).execution_payload_digest = `sha256:${'0'.repeat(64)}`;
        object(object(claim.claims).binding).execution_payload_canonicalization_profile =
          'RFC8785/JCS';
      }
      return json(claim);
    };
    const decision = await gate.authorize(request('ledger.settle'));
    const effect = vi.fn();
    expect((await new PolicyExecutor(gate).execute(decision, effect)).executed).toBe(false);
    expect(effect).not.toHaveBeenCalled();
    expect(await gate.claimGrant(grantId)).toBe(false);
  });

  it('holds an expired grant without any claim request', async () => {
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const decision = await gate.authorize(request('ledger.settle'));
    wire.time += 10_000;
    expect((await new PolicyExecutor(gate).execute(decision, vi.fn())).executed).toBe(false);
    expect(wire.fetch).toHaveBeenCalledOnce();
  });

  it.each(['network', 'http500', 'http503'])(
    'distinguishes a pre-dispatch %s failure for the caller’s declared local fallback',
    async (failure) => {
      const wire = new HostedFixture();
      const { gate } = wire.gate();
      const decision = await gate.authorize(request('ledger.settle'));
      wire.handler = () => {
        if (failure === 'network') throw new Error('network unavailable');
        return json({ error: 'unavailable' }, failure === 'http500' ? 500 : 503);
      };
      const effect = vi.fn();
      expect(await new PolicyExecutor(gate).execute(decision, effect)).toEqual({
        executed: false,
        reason: 'GRANT_UNAVAILABLE',
      });
      expect(effect).not.toHaveBeenCalled();
      expect(wire.calls).toHaveLength(2);
    },
  );

  it.each([401, 403, 409, 429])('never labels HTTP %i refusal as unavailable', async (status) => {
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const decision = await gate.authorize(request('ledger.settle'));
    wire.handler = () => json({ error: 'refused' }, status);
    expect(await new PolicyExecutor(gate).execute(decision, vi.fn())).toEqual({
      executed: false,
      reason: 'GRANT_INVALID_OR_USED',
    });
  });

  it.each(['HTTP refusal', 'oversized response'])(
    'preserves %s when stream cancellation stalls',
    async (fault) => {
      vi.useFakeTimers();
      const wire = new HostedFixture();
      const { gate } = wire.gate();
      const decision = await gate.authorize(request('ledger.settle'));
      const cancel = vi.fn(() => new Promise<void>(() => undefined));
      wire.handler = () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              if (fault === 'oversized response') controller.enqueue(new Uint8Array(300 * 1024));
            },
            cancel,
          }),
          { status: fault === 'HTTP refusal' ? 409 : 200 },
        );
      const effect = vi.fn();
      const pending = new PolicyExecutor(gate).execute(decision, effect);
      await vi.advanceTimersByTimeAsync(120);
      expect(await pending).toEqual({ executed: false, reason: 'GRANT_INVALID_OR_USED' });
      expect(cancel).toHaveBeenCalledOnce();
      expect(effect).not.toHaveBeenCalled();
    },
  );

  it('marks claim timeout unavailable without executing or issuing a second claim', async () => {
    vi.useFakeTimers();
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const decision = await gate.authorize(request('ledger.settle'));
    wire.handler = () => new Promise(() => undefined);
    const effect = vi.fn();
    const pending = new PolicyExecutor(gate).execute(decision, effect);
    await vi.advanceTimersByTimeAsync(120);
    expect(await pending).toEqual({ executed: false, reason: 'GRANT_UNAVAILABLE' });
    expect(effect).not.toHaveBeenCalled();
    expect(wire.calls).toHaveLength(2);
  });

  it('reports an uncertain effect as INDETERMINATE and never dispatches it twice', async () => {
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const decision = await gate.authorize(request('ledger.settle'));
    const effect = vi.fn(() => {
      throw new Error('connection lost after dispatch');
    });
    const executor = new PolicyExecutor(gate);
    expect(await executor.execute(decision, effect)).toMatchObject({
      executed: false,
      reason: 'EFFECT_FAILED',
    });
    expect(wire.calls.at(-1)?.body.outcome).toBe('INDETERMINATE');
    expect((await executor.execute(decision, effect)).executed).toBe(false);
    expect(effect).toHaveBeenCalledOnce();
  });

  it.each(['error', 'unrecorded'])(
    'keeps a completed effect executed when its receipt is %s',
    async (fault) => {
      const wire = new HostedFixture();
      const { gate } = wire.gate();
      wire.handler = (path, body) => {
        if (path.endsWith('/receipts')) {
          if (fault === 'error') throw new Error('receipt service unavailable');
          return json({ finalized: false, reason_codes: ['EVIDENCE_PENDING'] });
        }
        return wire.respond(path, body);
      };
      const decision = await gate.authorize(request('ledger.settle'));
      const effect = vi.fn(() => 42);
      const executor = new PolicyExecutor(gate);
      expect(await executor.execute(decision, effect)).toEqual({
        executed: true,
        value: 42,
        reason: 'RECEIPT_PENDING',
      });
      expect((await executor.execute(decision, effect)).executed).toBe(false);
      expect(effect).toHaveBeenCalledOnce();
    },
  );

  it('freezes the exact Helix request before a claim yields', async () => {
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const req = request('chat.send');
    req.actor = { kind: 'system', twitchUserId: 'bot' };
    req.payload = { text: 'Welcome', templated: true };
    const decision = await gate.authorize(req);
    let release: (() => void) | undefined;
    wire.handler = (path, body) =>
      path.endsWith('/claims')
        ? new Promise((resolve) => {
            release = () => resolve(json(wire.claim()));
          })
        : wire.respond(path, body);
    const write: HelixWrite = {
      method: 'POST',
      path: '/chat/messages',
      body: { broadcaster_id: 'host', sender_id: 'bot', message: 'Welcome' },
    };
    const helix = vi.fn<typeof fetch>().mockResolvedValue(json({ data: [] }));
    const pending = new PolicyExecutor(gate).executeHelix(decision, write, {
      clientId: 'client',
      accessToken: 'test',
      fetch: helix,
    });
    await Promise.resolve();
    write.path = '/moderation/bans';
    write.body!.message = 'Substituted';
    decision.grant!.id = 'forged';
    release?.();
    expect((await pending).executed).toBe(true);
    expect(String(helix.mock.calls[0]?.[0])).toBe('https://api.twitch.tv/helix/chat/messages');
    expect(JSON.parse(String(helix.mock.calls[0]?.[1]?.body))).toMatchObject({
      message: 'Welcome',
    });
    expect(wire.calls.at(-1)?.path).toBe(`/v1/authority/grants/${grantId}/receipts`);
  });

  it('bounds Helix dispatch to the remaining claim lease', async () => {
    vi.useFakeTimers();
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const req = request('chat.send');
    req.actor = { kind: 'system', twitchUserId: 'bot' };
    req.payload = { text: 'Welcome', templated: true };
    const decision = await gate.authorize(req);
    wire.handler = (path, body) =>
      path.endsWith('/claims')
        ? json({ ...wire.claim(), claim_lease_expires_at: new Date(wire.time + 100).toISOString() })
        : wire.respond(path, body);
    const helix = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const pending = new PolicyExecutor(gate).executeHelix(
      decision,
      {
        method: 'POST',
        path: '/chat/messages',
        body: { broadcaster_id: 'host', sender_id: 'bot', message: 'Welcome' },
      },
      { clientId: 'client', accessToken: 'test', fetch: helix },
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(helix.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(await pending).toMatchObject({ executed: false, reason: 'EFFECT_FAILED' });
    expect(wire.calls.at(-1)?.body.outcome).toBe('INDETERMINATE');
  });

  it('refuses a still-live grant identifier that already completed another decision', async () => {
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const req = request('content.render');
    req.payload = { text: 'Arena ready' };
    const first = await gate.authorize(req);
    expect((await new PolicyExecutor(gate).execute(first, () => 1)).executed).toBe(true);
    wire.handler = () => json({ ...wire.decision(), decision_id: 'different.decision' });
    expect(await gate.authorize(req)).toMatchObject({ source: 'local', verdict: 'BLOCK' });
  });
});
