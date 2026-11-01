import { describe, expect, it, vi } from 'vitest';
import { DecionisGate } from '../src/decionis/gate.js';
import { PolicyExecutor } from '../src/executor.js';
import { defaultPolicy } from '../src/defaults.js';
import { grantId, HostedFixture, json, object, orgId } from './hosted.js';
import { request } from './helpers.js';

function setup(selected = true) {
  const fixture = new HostedFixture();
  const config = defaultPolicy();
  config.defaults.mode = 'enforce';
  config.lists.allow = ['trusted'];
  config.lists.block = ['blocked'];
  const gate = new DecionisGate(config, {
    orgId,
    apiKey: 'runtime',
    ...(selected ? { policyId: 'raidrumble', policyVersion: 'raidrumble.v1' } : {}),
    fetch: fixture.fetch,
    now: () => fixture.time,
    logger: () => undefined,
  });
  return { fixture, gate };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function delayedIssuance(selected: boolean) {
  const f = setup(selected);
  const req = request();
  req.payload.raiderLogin = 'trusted';
  const entered = deferred();
  const release = deferred();
  f.fixture.handler = async (path, body) => {
    entered.resolve();
    await release.promise;
    return f.fixture.respond(path, body);
  };
  const pending = f.gate.authorize(req);
  await entered.promise;
  return { ...f, req, pending, release };
}

async function delayedApproval(kind: 'local' | 'managed', selected = true) {
  const f = setup(selected);
  const req = request();
  if (kind === 'managed') {
    req.payload.raiderLogin = 'trusted';
    f.fixture.handler = () => json(f.fixture.hold());
  }
  const held = await f.gate.authorize(req);
  const entered = deferred();
  const release = deferred();
  f.fixture.handler = async (path, body) => {
    if (kind === 'managed' && path.endsWith('/claims')) {
      const claim = f.fixture.claim();
      object(claim.claims).decision_id = 'ready.decision';
      return json(claim);
    }
    if (
      (kind === 'local' && path === '/v1/authority/grants') ||
      (kind === 'managed' && path.includes('/escalations/'))
    ) {
      entered.resolve();
      await release.promise;
      return kind === 'managed'
        ? json(f.fixture.status('GRANT_READY'))
        : f.fixture.respond(path, body);
    }
    return f.fixture.respond(path, body);
  };
  const pending = f.gate.approve(held.decisionId, 'host');
  await entered.promise;
  return { ...f, req, held, pending, release };
}

describe('trusted local policy assertions', () => {
  it('derives the assertion internally and never promotes caller-supplied approval facts', async () => {
    const { fixture, gate } = setup();
    const req = request();
    req.payload.raiderLogin = 'trusted';
    req.payload.raidrumble = { localVerdict: 'ALLOW', localHostApproved: true };
    await gate.authorize(req);
    expect(object(fixture.intent.context).raidrumble).toEqual({
      application: 'raidrumble',
      schema: 1,
      action: 'rumble.start',
      localVerdict: 'ALLOW',
      localReasonCodes: ['RAIDER_ALLOWLISTED'],
      localHostApproved: false,
    });
  });

  it('keeps unknown and blocked raids local until exact host approval', async () => {
    const { fixture, gate } = setup();
    const blocked = request();
    blocked.payload.raiderLogin = 'blocked';
    blocked.payload.localHostApproved = true;
    expect(await gate.authorize(blocked)).toMatchObject({ source: 'local', verdict: 'BLOCK' });
    const pending = await gate.authorize(request());
    expect(pending).toMatchObject({ source: 'local', verdict: 'ESCALATE' });
    expect(fixture.calls).toHaveLength(0);
    await expect(gate.approve(pending.decisionId, 'other')).rejects.toThrow();
    expect(fixture.calls).toHaveLength(0);
    await gate.approve(pending.decisionId, 'host');
    expect(object(fixture.intent.context).raidrumble).toMatchObject({
      localVerdict: 'ESCALATE',
      localReasonCodes: ['UNKNOWN_RAIDER'],
      localHostApproved: true,
    });
  });

  it('does not turn a managed hosted hold into a local approval assertion', async () => {
    const { fixture, gate } = setup();
    const req = request();
    req.payload.raiderLogin = 'trusted';
    fixture.handler = (path) =>
      json(path === '/v1/authority/grants' ? fixture.hold() : fixture.status());
    const held = await gate.authorize(req);
    const original = structuredClone(fixture.intent);
    expect(held).toMatchObject({ source: 'decionis', verdict: 'ESCALATE' });
    expect(await gate.approve(held.decisionId, 'host')).toEqual(held);
    expect(fixture.intent).toEqual(original);
    expect(object(fixture.intent.context).raidrumble).toMatchObject({ localHostApproved: false });
    expect(fixture.calls.filter((call) => call.path === '/v1/authority/grants')).toHaveLength(1);
  });

  it('keeps changed blocklists authoritative when approval arrives', async () => {
    const { fixture, gate } = setup();
    const held = await gate.authorize(request());
    gate.updateLists({ block: ['visitor'] });
    expect(await gate.approve(held.decisionId, 'host')).toMatchObject({
      source: 'local',
      verdict: 'BLOCK',
      reasonCodes: ['RAIDER_BLOCKLISTED'],
    });
    expect(fixture.calls).toHaveLength(0);
  });

  it.each([
    ['local', true],
    ['local', false],
    ['managed', true],
    ['managed', false],
  ] as const)(
    'refuses %s approval when blocked during the hosted await (selected=%s)',
    async (kind, selected) => {
      const f = await delayedApproval(kind, selected);
      const captured = structuredClone(f.fixture.intent);
      f.gate.updateLists({ block: [String(f.req.payload.raiderLogin)] });
      f.release.resolve();
      const blocked = await f.pending;
      expect(blocked).toMatchObject({
        source: 'local',
        verdict: 'BLOCK',
        mode: 'enforce',
        reasonCodes: ['RAIDER_BLOCKLISTED'],
      });
      expect(blocked.grant).toBeUndefined();
      expect(await f.gate.claimGrant(grantId)).toBe(false);
      const effect = vi.fn();
      expect((await new PolicyExecutor(f.gate).execute(blocked, effect)).executed).toBe(false);
      expect(effect).not.toHaveBeenCalled();
      expect(f.fixture.calls.some(({ path }) => path.endsWith('/claims'))).toBe(false);
      expect(f.fixture.intent).toEqual(captured);
      await expect(f.gate.approve(f.held.decisionId, 'host')).rejects.toThrow();
    },
  );

  it.each(['local', 'managed'] as const)(
    'preserves valid %s approval, selected intent and the original deadline',
    async (kind) => {
      const f = await delayedApproval(kind);
      const captured = structuredClone(f.fixture.intent);
      const deadline = Date.parse(String(captured.expires_at));
      f.fixture.time += 100;
      f.release.resolve();
      const approved = await f.pending;
      expect(approved).toMatchObject({
        source: 'decionis',
        verdict: 'ALLOW',
        mode: 'enforce',
        grant: { expiresAt: deadline },
      });
      expect(f.fixture.intent).toEqual(captured);
      expect(object(object(captured.action).parameters)).toMatchObject({
        policy_id: 'raidrumble',
        policy_version: 'raidrumble.v1',
      });
      expect(object(captured.context).raidrumble).toMatchObject({
        localHostApproved: kind === 'local',
      });
      const effect = vi.fn(() => 'started');
      expect(await new PolicyExecutor(f.gate).execute(approved, effect)).toEqual({
        executed: true,
        value: 'started',
      });
      expect(effect).toHaveBeenCalledOnce();
      await expect(f.gate.approve(f.held.decisionId, 'host')).rejects.toThrow();
    },
  );

  it.each([
    ['issuance', true],
    ['issuance', false],
    ['managed', true],
    ['managed', false],
  ] as const)(
    'holds %s authority if local trust is removed during the await (selected=%s)',
    async (kind, selected) => {
      const f =
        kind === 'issuance'
          ? await delayedIssuance(selected)
          : await delayedApproval('managed', selected);
      const captured = structuredClone(f.fixture.intent);
      const deadline = Date.parse(String(captured.expires_at));
      if (selected)
        expect(object(captured.context).raidrumble).toMatchObject({ localHostApproved: false });
      f.gate.updateLists({ allow: [] });
      f.fixture.time += 100;
      f.release.resolve();
      const held = await f.pending;
      expect(held).toMatchObject({
        source: 'local',
        verdict: 'ESCALATE',
        mode: 'enforce',
        reasonCodes: ['UNKNOWN_RAIDER'],
      });
      expect(held.grant).toBeUndefined();
      expect(f.gate.getRequest(held.decisionId)).toEqual(f.req);
      expect(f.gate.listRecords().at(-1)?.expiresAt).toBe(deadline);
      expect(f.fixture.intent).toEqual(captured);
      expect(await f.gate.claimGrant(grantId)).toBe(false);
      const effect = vi.fn();
      expect((await new PolicyExecutor(f.gate).execute(held, effect)).executed).toBe(false);
      expect(effect).not.toHaveBeenCalled();
      expect(f.fixture.calls.some(({ path }) => path.endsWith('/claims'))).toBe(false);
      f.fixture.time = deadline;
      await expect(f.gate.approve(held.decisionId, 'host')).rejects.toThrow('expired');
    },
  );

  it.each([true, false])(
    'retains genuine local approval through a managed hold after trust removal (selected=%s)',
    async (selected) => {
      const { fixture, gate } = setup(selected);
      const original = await gate.authorize(request());
      fixture.handler = (path) =>
        json(path === '/v1/authority/grants' ? fixture.hold() : fixture.status());
      const managed = await gate.approve(original.decisionId, 'host');
      const captured = structuredClone(fixture.intent);
      const deadline = Date.parse(String(captured.expires_at));
      expect(managed).toMatchObject({ source: 'decionis', verdict: 'ESCALATE' });
      expect(await gate.approve(managed.decisionId, 'host')).toEqual(managed);
      if (selected)
        expect(object(captured.context).raidrumble).toMatchObject({ localHostApproved: true });
      const entered = deferred();
      const release = deferred();
      fixture.handler = async (path, body) => {
        if (path.includes('/escalations/')) {
          entered.resolve();
          await release.promise;
          return json(fixture.status('GRANT_READY'));
        }
        if (path.endsWith('/claims')) {
          const claim = fixture.claim();
          object(claim.claims).decision_id = 'ready.decision';
          return json(claim);
        }
        return fixture.respond(path, body);
      };
      gate.updateLists({ allow: ['visitor'] });
      const pending = gate.approve(managed.decisionId, 'host');
      await entered.promise;
      gate.updateLists({ allow: [] });
      fixture.time += 100;
      release.resolve();
      const approved = await pending;
      expect(approved).toMatchObject({
        source: 'decionis',
        verdict: 'ALLOW',
        grant: { expiresAt: deadline },
      });
      expect(fixture.intent).toEqual(captured);
      const effect = vi.fn(() => 'started');
      expect(await new PolicyExecutor(gate).execute(approved, effect)).toEqual({
        executed: true,
        value: 'started',
      });
      expect(effect).toHaveBeenCalledOnce();
    },
  );
});
