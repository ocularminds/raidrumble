import { describe, expect, it } from 'vitest';
import { DecionisGate } from '../src/decionis/gate.js';
import { DecionisMapping } from '../src/decionis/mapping.js';
import type { DecionisOptions } from '../src/decionis/models.js';
import { defaultPolicy } from '../src/defaults.js';
import { HostedFixture, json, object, orgId } from './hosted.js';
import { request } from './helpers.js';

const bundle = '77777777-7777-4777-8777-777777777777';
const intent = '88888888-8888-4888-8888-888888888888';
const version = 'raidrumble-v1';

function setup(options: Partial<DecionisOptions> = {}) {
  const fixture = new HostedFixture();
  const config = defaultPolicy();
  config.defaults.mode = 'enforce';
  config.lists.allow = ['visitor'];
  const gate = new DecionisGate(config, {
    apiKey: 'runtime',
    orgId,
    now: () => fixture.time,
    fetch: fixture.fetch,
    logger: () => undefined,
    policyId: bundle,
    policyVersion: version,
    ...options,
  });
  return { fixture, gate };
}

describe('explicit hosted policy selection', () => {
  it.each(['raidrumble', bundle])('binds selector %s before canonical hashing', (policyId) => {
    const req = request();
    const original = DecionisMapping.capture(req, orgId, intent, 0, 10_000);
    const selected = DecionisMapping.capture(req, orgId, intent, 0, 10_000, {
      policyId,
      policyVersion: version,
    });
    expect(selected.binding.action.parameters).toMatchObject({
      policy_id: policyId,
      policy_version: version,
    });
    expect(selected.hash).not.toBe(original.hash);
    expect(req.payload).not.toHaveProperty('policy_id');
    const changed = DecionisMapping.capture(req, orgId, intent, 0, 10_000, {
      policyId,
      policyVersion: 'raidrumble-v2',
    });
    expect(changed.hash).not.toBe(selected.hash);
  });

  it.each([
    { policyVersion: version },
    { policyId: '../other' },
    { policyId: 'name with spaces' },
    { policyId: '' },
    { policyId: 'raidrumble', policyVersion: '' },
    { policyId: 'raidrumble', policyVersion: 'v\n1' },
  ])('rejects ambiguous or malformed configuration %j', (options) => {
    expect(() => new DecionisGate(defaultPolicy(), options)).toThrow();
  });

  it('sends exact selectors to authority and refuses the wrong version', async () => {
    const { fixture, gate } = setup();
    fixture.handler = () => json(fixture.decision());
    const decision = await gate.authorize(request());
    expect(object(fixture.calls[0]?.body.action).parameters).toMatchObject({
      policy_id: bundle,
      policy_version: version,
    });
    expect(decision).toMatchObject({
      source: 'local',
      verdict: 'ESCALATE',
      reasonCodes: ['POLICY_ERROR'],
    });
    expect(decision.grant).toBeUndefined();
  });

  it('accepts the selected version but still rejects a changed intent hash', async () => {
    const { fixture, gate } = setup();
    fixture.handler = () => json({ ...fixture.decision(), policy_version: version });
    expect(await gate.authorize(request())).toMatchObject({ source: 'decionis', verdict: 'ALLOW' });
    fixture.handler = () =>
      json({
        ...fixture.decision(),
        policy_version: version,
        action_hash: `sha256:${'f'.repeat(64)}`,
      });
    expect(await gate.authorize(request())).toMatchObject({ source: 'local', verdict: 'ESCALATE' });
  });

  it('uses top-level exact selectors for protocol shadow and validates the snapshot', async () => {
    const { fixture, gate } = setup({ shadowRoute: 'protocol' });
    gate.setMode('rumble.start', 'shadow');
    const response = {
      outcome: 'APPROVE',
      evaluation_id: 'evaluation',
      dossier_id: 'dossier',
      mode: 'SHADOW',
      policy_version: version,
      policy_snapshot: { source: 'org_policy_bundle', policy_bundle_id: bundle },
    };
    fixture.handler = () => json(response);
    expect(await gate.authorize(request())).toMatchObject({ source: 'decionis', mode: 'shadow' });
    expect(fixture.calls[0]?.body).toMatchObject({
      policy_id: bundle,
      policy_version: version,
      require_exact_policy_version: true,
    });
    fixture.handler = () =>
      json({
        ...response,
        policy_snapshot: { source: 'org_policy_bundle', policy_bundle_id: intent },
      });
    expect(await gate.authorize(request())).toMatchObject({ source: 'local', verdict: 'ESCALATE' });
  });

  it('refuses a named protocol selection answered by a default or fallback snapshot', () => {
    const response = {
      outcome: 'APPROVE',
      evaluation_id: 'evaluation',
      dossier_id: 'dossier',
      mode: 'SHADOW',
      policy_version: version,
      policy_snapshot: { source: 'fallback', policy_bundle_id: bundle },
    };
    expect(() => DecionisMapping.protocol(response, { policyId: 'raidrumble' })).toThrow();
  });
});
