import { describe, expect, it, vi } from 'vitest';
import { PolicyExecutor } from '../src/executor.js';
import type { HelixWrite } from '../src/models.js';
import { request, setup } from './helpers.js';
import { HostedFixture, json } from './hosted.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const wire = new HostedFixture();
  const { gate } = wire.gate();
  const subscription = {
    type: 'channel.raid',
    version: '1',
    condition: { to_broadcaster_user_id: 'host' },
    transport: { method: 'websocket', session_id: 'session' },
  };
  const req = request('events.subscribe');
  req.actor = { kind: 'host', twitchUserId: 'host' };
  req.payload = { subscription };
  const decision = await gate.authorize(req);
  const write: HelixWrite = {
    method: 'POST',
    path: '/eventsub/subscriptions',
    body: subscription,
  };
  const transport = vi.fn<typeof fetch>(async () => json({ data: [] }));
  const credentials = { clientId: 'client', accessToken: 'test', fetch: transport };
  return {
    wire,
    gate,
    decision,
    write,
    transport,
    credentials,
    executor: new PolicyExecutor(gate),
  };
}

function suspendClaim(wire: HostedFixture) {
  const entered = deferred();
  const release = deferred();
  wire.handler = async (path, body) => {
    if (path.endsWith('/claims')) {
      entered.resolve();
      await release.promise;
    }
    return wire.respond(path, body);
  };
  return { entered, release };
}

describe('synchronous dispatch guard', () => {
  it('cancels a stale action after its suspended claim and never replays it', async () => {
    const f = await fixture();
    const claim = suspendClaim(f.wire);
    let current = true;
    const canExecute = vi.fn(() => current);
    const pending = f.executor.executeHelix(f.decision, f.write, f.credentials, canExecute);
    await claim.entered.promise;
    expect(canExecute).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
    current = false;
    claim.release.resolve();
    expect(await pending).toEqual({ executed: false, reason: 'EXECUTION_CANCELLED' });
    expect(canExecute).toHaveBeenCalledOnce();
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.wire.calls.at(-1)?.body.outcome).toBe('FAILED');

    current = true;
    expect(await f.executor.executeHelix(f.decision, f.write, f.credentials, canExecute)).toEqual({
      executed: false,
      reason: 'DECISION_INVALID_OR_USED',
    });
    expect(await f.gate.claimGrant(f.decision.grant!.id)).toBe(false);
    expect(f.wire.calls.filter(({ path }) => path.endsWith('/claims'))).toHaveLength(1);
    expect(f.wire.calls.filter(({ path }) => path.endsWith('/receipts'))).toHaveLength(1);
    expect(f.transport).not.toHaveBeenCalled();
  });

  it('fails closed when a guard throws, with a FAILED receipt and no private error', async () => {
    const f = await fixture();
    const canExecute = vi.fn(() => {
      throw new Error('private stale session detail');
    });
    const result = await f.executor.executeHelix(f.decision, f.write, f.credentials, canExecute);
    expect(result).toEqual({ executed: false, reason: 'EXECUTION_CANCELLED' });
    expect(canExecute).toHaveBeenCalledOnce();
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.wire.calls.at(-1)?.body.outcome).toBe('FAILED');
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('dispatches a valid guarded write once without an await between guard and effect', async () => {
    const f = await fixture();
    let current = true;
    const canExecute = vi.fn(() => {
      expect(f.wire.calls.at(-1)?.path.endsWith('/claims')).toBe(true);
      queueMicrotask(() => {
        current = false;
      });
      return current;
    });
    f.transport.mockImplementation(async () => {
      expect(current).toBe(true);
      return json({ data: [] });
    });
    expect(await f.executor.executeHelix(f.decision, f.write, f.credentials, canExecute)).toEqual({
      executed: true,
      value: { data: [] },
    });
    expect(canExecute).toHaveBeenCalledOnce();
    expect(f.transport).toHaveBeenCalledOnce();
    expect(f.wire.calls.at(-1)?.body.outcome).toBe('COMMITTED');
    expect(
      (await f.executor.executeHelix(f.decision, f.write, f.credentials, canExecute)).executed,
    ).toBe(false);
    expect(canExecute).toHaveBeenCalledOnce();
    expect(f.transport).toHaveBeenCalledOnce();
  });

  it('applies the same guard to non-Helix effects', async () => {
    const f = await fixture();
    const claim = suspendClaim(f.wire);
    const effect = vi.fn(() => 'started');
    let current = true;
    const pending = f.executor.execute(f.decision, effect, () => current);
    await claim.entered.promise;
    current = false;
    claim.release.resolve();
    expect(await pending).toEqual({ executed: false, reason: 'EXECUTION_CANCELLED' });
    expect(effect).not.toHaveBeenCalled();
    expect(f.wire.calls.at(-1)?.body.outcome).toBe('FAILED');
  });

  it('keeps cancellation final when its FAILED receipt cannot be confirmed', async () => {
    const f = await fixture();
    f.wire.handler = (path, body) => {
      if (path.endsWith('/receipts')) throw new Error('receipt unavailable');
      return f.wire.respond(path, body);
    };
    expect(await f.executor.executeHelix(f.decision, f.write, f.credentials, () => false)).toEqual({
      executed: false,
      reason: 'EXECUTION_CANCELLED',
    });
    expect(
      (await f.executor.executeHelix(f.decision, f.write, f.credentials, () => true)).executed,
    ).toBe(false);
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.wire.calls.filter(({ path }) => path.endsWith('/receipts'))).toHaveLength(1);
  });

  it.each(['BLOCK', 'ESCALATE'] as const)('does not let a guard override %s', async (verdict) => {
    const { gate } = setup();
    const req = request();
    if (verdict === 'BLOCK') req.payload.raiderLogin = 'blocked';
    const decision = await gate.authorize(req);
    const effect = vi.fn();
    const canExecute = vi.fn(() => true);
    expect(await new PolicyExecutor(gate).execute(decision, effect, canExecute)).toEqual({
      executed: false,
      reason: verdict,
    });
    expect(canExecute).not.toHaveBeenCalled();
    expect(effect).not.toHaveBeenCalled();
  });

  it('retains exact request binding before the guard or claim', async () => {
    const f = await fixture();
    const canExecute = vi.fn(() => true);
    const write = { ...f.write, body: { ...f.write.body, type: 'channel.ban' } };
    expect(await f.executor.executeHelix(f.decision, write, f.credentials, canExecute)).toEqual({
      executed: false,
      reason: 'REQUEST_MISMATCH',
    });
    expect(canExecute).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.wire.calls).toHaveLength(1);
  });

  it('retains claim rejection before evaluating a successful guard', async () => {
    const f = await fixture();
    f.wire.handler = () => json({ valid: false, should_execute: false }, 409);
    const canExecute = vi.fn(() => true);
    expect(await f.executor.executeHelix(f.decision, f.write, f.credentials, canExecute)).toEqual({
      executed: false,
      reason: 'GRANT_INVALID_OR_USED',
    });
    expect(canExecute).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.wire.calls.filter(({ path }) => path.endsWith('/receipts'))).toHaveLength(0);
  });

  it('retains execution expiry before the guard or dispatch', async () => {
    const f = await fixture();
    f.wire.handler = (path, body) => {
      const response = f.wire.respond(path, body);
      if (path.endsWith('/claims')) f.wire.time += 1_500;
      return response;
    };
    const canExecute = vi.fn(() => true);
    expect(await f.executor.executeHelix(f.decision, f.write, f.credentials, canExecute)).toEqual({
      executed: false,
      reason: 'GRANT_EXPIRED',
    });
    expect(canExecute).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.wire.calls.at(-1)?.body.outcome).toBe('FAILED');
  });
});
