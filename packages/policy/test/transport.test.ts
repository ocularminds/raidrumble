import { afterEach, describe, expect, it, vi } from 'vitest';
import { DecionisGate } from '../src/decionis/gate.js';
import { DecionisMapping } from '../src/decionis/mapping.js';
import { defaultPolicy } from '../src/defaults.js';
import { PolicyExecutor } from '../src/executor.js';
import { request } from './helpers.js';
import { HostedFixture, json, orgId } from './hosted.js';

afterEach(() => vi.useRealTimers());

describe('hosted transport trust boundary', () => {
  it.each([
    'https://raidrumble.decionisedge.com',
    'https://decionisedge.com',
    'http://api.decionis.com',
    'https://user:secret@api.decionis.com',
    'https://api.decionis.com/redirect',
  ])('never sends an authority credential to %s', async (apiBase) => {
    const transport = vi.fn<typeof fetch>();
    const gate = new DecionisGate(defaultPolicy(), {
      apiBase,
      apiKey: 'test',
      orgId,
      fetch: transport,
      logger: () => undefined,
    });
    const req = request('content.render');
    req.payload = { text: 'Arena ready' };
    expect(await gate.authorize(req)).toMatchObject({ source: 'local', verdict: 'BLOCK' });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([401, 403, 409, 429, 500, 503])(
    'holds a shadow action on HTTP %s without another request',
    async (status) => {
      const wire = new HostedFixture();
      const { gate } = wire.gate('shadow');
      wire.handler = () => json({ error: 'remote refused' }, status);
      const req = request('chat.send');
      req.payload = { text: 'Welcome', templated: true };
      const decision = await gate.authorize(req);
      expect(decision).toMatchObject({ source: 'local', verdict: 'BLOCK' });
      expect((await new PolicyExecutor(gate).execute(decision, vi.fn())).executed).toBe(false);
      expect(wire.fetch).toHaveBeenCalledOnce();
    },
  );

  it('bounds response bytes and cancels an oversized response', async () => {
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    const cancel = vi.fn();
    wire.handler = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(300 * 1024));
          },
          cancel,
        }),
      );
    const req = request('content.render');
    req.payload = { text: 'Arena ready' };
    expect(await gate.authorize(req)).toMatchObject({ source: 'local', verdict: 'BLOCK' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not follow redirects or expose arbitrary server bodies', async () => {
    const wire = new HostedFixture();
    const { gate, logger } = wire.gate();
    wire.handler = () => json({ error: 'private execution bearer in failure response' }, 302);
    const decision = await gate.authorize(request('ledger.settle'));
    expect(wire.fetch.mock.calls[0]?.[1]?.redirect).toBe('error');
    expect(JSON.stringify({ decision, records: logger.mock.calls })).not.toContain(
      'private execution bearer',
    );
  });

  it('captures the request and configured mode before the network yields', async () => {
    const wire = new HostedFixture();
    const { gate } = wire.gate();
    let finish: (() => void) | undefined;
    wire.handler = () =>
      new Promise((resolve) => {
        finish = () => resolve(json(wire.decision()));
      });
    const req = request();
    req.payload.raiderLogin = 'trusted';
    const pending = gate.authorize(req);
    req.channel.hostId = 'other';
    req.payload.raiderLogin = 'blocked';
    gate.setMode('rumble.start', 'shadow');
    finish?.();
    const decision = await pending;
    expect(decision.mode).toBe('enforce');
    expect(gate.getRequest(decision.decisionId)?.channel.hostId).toBe('host');
    expect(gate.getRequest(decision.decisionId)?.payload.raiderLogin).toBe('trusted');
  });

  it.each(['unknown', 'constructor', '__proto__'])(
    'rejects unrecognized authority status %s',
    async (status) => {
      const wire = new HostedFixture();
      const { gate } = wire.gate();
      wire.handler = () => json(wire.decision('enforce', status));
      expect(await gate.authorize(request('ledger.settle'))).toMatchObject({
        source: 'local',
        reasonCodes: expect.arrayContaining(['POLICY_ERROR']),
      });
    },
  );

  it.each(['unknown', 'constructor', '__proto__'])(
    'rejects unrecognized protocol outcome %s',
    (outcome) => {
      expect(() =>
        DecionisMapping.protocol({
          outcome,
          mode: 'SHADOW',
          evaluation_id: 'evaluation',
          dossier_id: 'dossier',
          reason_codes: [],
        }),
      ).toThrow();
    },
  );

  it('rejects inconsistent observational protocol authority', () => {
    expect(() =>
      DecionisMapping.protocol({
        outcome: 'APPROVE',
        mode: 'SHADOW',
        evaluation_id: 'evaluation',
        dossier_id: 'dossier',
        reason_codes: [],
        authority_classification: 'AUTHORITATIVE',
        execution_eligible: true,
      }),
    ).toThrow();
  });
});
