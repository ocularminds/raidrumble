import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPolicy } from '../src/defaults.js';
import { parsePolicy } from '../src/config.js';
import { LocalPolicyGate } from '../src/local.js';
import { PolicyExecutor } from '../src/executor.js';
import { DecionisGate } from '../src/decionis/gate.js';
import { request } from './helpers.js';
import { HostedFixture, json } from './hosted.js';

afterEach(() => vi.useRealTimers());

async function advance(wire: HostedFixture, ms: number): Promise<void> {
  wire.time += ms;
  await vi.advanceTimersByTimeAsync(ms);
}

describe('captured action latency allowances', () => {
  it('preserves a shorter per-action approval deadline in hosted mode', async () => {
    const config = defaultPolicy();
    config.defaults.mode = 'enforce';
    config.actions['rumble.start'].otherwise.timeoutMs = 500;
    const wire = new HostedFixture();
    const gate = new DecionisGate(config, {
      now: () => wire.time,
      fetch: wire.fetch,
      logger: () => undefined,
    });
    const started = wire.time;
    const held = await gate.authorize(request());
    expect(gate.listRecords().at(-1)?.expiresAt).toBe(started + 500);
    wire.time += 500;
    await expect(gate.approve(held.decisionId, 'host')).rejects.toThrow('expired');
    expect(wire.fetch).not.toHaveBeenCalled();
  });

  it('does not restart a local approval deadline after a slow failed evaluation', async () => {
    vi.useFakeTimers();
    let now = 1000;
    const config = defaultPolicy();
    config.actions['rumble.start'].otherwise.timeoutMs = 500;
    const gate = new LocalPolicyGate(config, {
      now: () => now,
      logger: () => undefined,
      evaluate: () => new Promise(() => undefined),
    });
    const pending = gate.authorize(request());
    now += 1500;
    await vi.advanceTimersByTimeAsync(1500);
    const held = await pending;
    expect(gate.listRecords().at(-1)?.expiresAt).toBe(1500);
    await expect(gate.approve(held.decisionId, 'host')).rejects.toThrow('expired');
  });

  it('configures the four setup actions without widening in-match budgets', () => {
    const config = defaultPolicy();
    for (const action of [
      'rumble.start',
      'rumble.start.collab',
      'rewards.configure',
      'events.subscribe',
    ] as const)
      expect(config.actions[action].latencyBudgetMs).toBe(1500);
    expect(config.defaults.latencyBudgetMs).toBe(120);
    expect(
      parsePolicy('version: 1\nactions:\n  rumble.start:\n    latencyBudgetMs: 900').actions[
        'rumble.start'
      ].latencyBudgetMs,
    ).toBe(900);
  });

  it.each(['chat.send: 1500', 'rumble.start: 1501', 'events.subscribe: 0'])(
    'rejects an invalid configured allowance: %s',
    (entry) => {
      const [action, budget] = entry.split(': ');
      expect(() =>
        parsePolicy(`version: 1\nactions:\n  ${action}:\n    latencyBudgetMs: ${budget}`),
      ).toThrow();
    },
  );

  it('lets a local setup evaluator finish after 120 ms but before its setup deadline', async () => {
    vi.useFakeTimers();
    const gate = new LocalPolicyGate(defaultPolicy(), {
      logger: () => undefined,
      evaluate: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ verdict: 'ALLOW', reasonCodes: ['READY'] }), 500),
        ),
    });
    const pending = gate.authorize(request());
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ verdict: 'ALLOW', reasonCodes: ['READY'] });
  });

  it('uses one setup window for hosted authorization and its immediate claim', async () => {
    vi.useFakeTimers();
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const req = request();
    req.payload.raiderLogin = 'trusted';
    wire.handler = (path, body) =>
      path.endsWith('/receipts')
        ? wire.respond(path, body)
        : new Promise((resolve) => setTimeout(() => resolve(wire.respond(path, body)), 500));
    const pending = gate.authorize(req);
    await advance(wire, 500);
    const decision = await pending;
    expect(decision.source).toBe('decionis');
    const effect = vi.fn(() => 'started');
    const execution = new PolicyExecutor(gate).execute(decision, effect);
    await advance(wire, 500);
    expect(await execution).toEqual({ executed: true, value: 'started' });
    expect(effect).toHaveBeenCalledOnce();
    expect(wire.calls).toHaveLength(3);
  });

  it('gives an immediate claim only the unused part of the 1500 ms setup window', async () => {
    vi.useFakeTimers();
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const req = request();
    req.payload.raiderLogin = 'trusted';
    wire.handler = (path, body) =>
      path.endsWith('/claims')
        ? new Promise(() => undefined)
        : new Promise((resolve) => setTimeout(() => resolve(wire.respond(path, body)), 900));
    const pending = gate.authorize(req);
    await advance(wire, 900);
    const decision = await pending;
    const effect = vi.fn();
    const completed = vi.fn();
    const execution = new PolicyExecutor(gate).execute(decision, effect).then((value) => {
      completed();
      return value;
    });
    await advance(wire, 599);
    expect(completed).not.toHaveBeenCalled();
    await advance(wire, 1);
    expect(await execution).toEqual({ executed: false, reason: 'GRANT_UNAVAILABLE' });
    expect(effect).not.toHaveBeenCalled();
  });

  it('starts a fresh bounded setup allowance for a later valid host approval', async () => {
    vi.useFakeTimers();
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const held = await gate.authorize(request());
    const deadline = gate.listRecords().at(-1)!.expiresAt!;
    await advance(wire, 8000);
    wire.handler = (path, body) =>
      path.endsWith('/receipts')
        ? wire.respond(path, body)
        : new Promise((resolve) => setTimeout(() => resolve(wire.respond(path, body)), 500));
    const pending = gate.approve(held.decisionId, 'host');
    await advance(wire, 500);
    const decision = await pending;
    expect(decision.source).toBe('decionis');
    expect(decision.grant?.expiresAt).toBe(deadline);
    const execution = new PolicyExecutor(gate).execute(decision, () => true);
    await advance(wire, 500);
    expect((await execution).executed).toBe(true);
  });

  it('never extends the original host deadline to finish late approval authorization', async () => {
    vi.useFakeTimers();
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const held = await gate.authorize(request());
    const deadline = gate.listRecords().at(-1)!.expiresAt!;
    await advance(wire, 9600);
    wire.handler = (path, body) =>
      new Promise((resolve) => setTimeout(() => resolve(wire.respond(path, body)), 500));
    const approval = gate.approve(held.decisionId, 'host');
    await advance(wire, 400);
    const decision = await approval;
    expect(decision).toMatchObject({
      source: 'local',
      verdict: 'ESCALATE',
      reasonCodes: ['POLICY_TIMEOUT'],
    });
    expect(gate.listRecords().at(-1)?.expiresAt).toBe(deadline);
    expect((await new PolicyExecutor(gate).execute(decision, vi.fn())).executed).toBe(false);
  });

  it('retains the 120 ms in-match deadline even when an object config asks for more', async () => {
    vi.useFakeTimers();
    const config = defaultPolicy();
    config.actions['content.render'].latencyBudgetMs = 1500;
    const gate = new LocalPolicyGate(config, {
      logger: () => undefined,
      evaluate: () => new Promise(() => undefined),
    });
    const pending = gate.authorize(request('content.render'));
    await vi.advanceTimersByTimeAsync(120);
    expect(await pending).toMatchObject({
      verdict: 'BLOCK',
      reasonCodes: ['POLICY_TIMEOUT', 'CONTENT_TEMPLATE_FALLBACK'],
    });
  });

  it('finalizes receipts on a separate bound after the effect has run', async () => {
    vi.useFakeTimers();
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const req = request();
    req.payload.raiderLogin = 'trusted';
    const decision = await gate.authorize(req);
    await advance(wire, 1450);
    wire.handler = (path) =>
      path.endsWith('/receipts') ? new Promise(() => undefined) : json(wire.claim());
    const effect = vi.fn(() => 'done');
    const execution = new PolicyExecutor(gate).execute(decision, effect);
    await advance(wire, 1);
    expect(effect).toHaveBeenCalledOnce();
    await advance(wire, 119);
    expect(await execution).toEqual({ executed: true, value: 'done', reason: 'RECEIPT_PENDING' });
    expect((await new PolicyExecutor(gate).execute(decision, effect)).executed).toBe(false);
    expect(effect).toHaveBeenCalledOnce();
  });
});
