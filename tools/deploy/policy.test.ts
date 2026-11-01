import { describe, expect, it, vi } from 'vitest';
import { PolicyPublisher } from './policy.js';
import { RaidRumblePolicy } from './rules.js';

const orgId = '11111111-1111-4111-8111-111111111111';
const bundleId = '77777777-7777-4777-8777-777777777777';
const time = '2026-11-01T01:00:00.000Z';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('dedicated RaidRumble publication', () => {
  it('publishes a named bundle without altering unrelated defaults', async () => {
    const payload = RaidRumblePolicy.bundle(orgId, bundleId, time);
    const defaults = [{ bundle_id: 'default', payload: { version: 'existing' } }];
    let saved = false;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'POST') {
        saved = true;
        expect(JSON.parse(String(init.body))).toEqual(payload);
        return json({ accepted: true, artifact: 'policy_bundle', artifact_id: bundleId }, 202);
      }
      return json({ bundles: saved ? [...defaults, { bundle_id: bundleId, payload }] : defaults });
    });
    const publisher = new PolicyPublisher({ apiKey: 'policy.test', orgId, fetch: fetcher });
    expect(await publisher.publish(payload)).toMatchObject({
      name: 'raidrumble',
      bundleId,
      version: 'raidrumble-v1',
      created: true,
    });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('reuses an identical named revision without posting again', async () => {
    const existing = RaidRumblePolicy.bundle(orgId, bundleId, time);
    const proposed = RaidRumblePolicy.bundle(orgId, '88888888-8888-4888-8888-888888888888', time);
    const fetcher = vi.fn<typeof fetch>(async () =>
      json({ bundles: [{ bundle_id: bundleId, payload: existing }] }),
    );
    const publisher = new PolicyPublisher({ apiKey: 'policy.test', orgId, fetch: fetcher });
    expect(await publisher.publish(proposed)).toMatchObject({ bundleId, created: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refuses a conflicting same-name/version bundle instead of overwriting it', async () => {
    const proposed = RaidRumblePolicy.bundle(orgId, bundleId, time);
    const existing = { ...proposed, rules: [] };
    const fetcher = vi.fn<typeof fetch>(async () =>
      json({ bundles: [{ bundle_id: bundleId, payload: existing }] }),
    );
    const publisher = new PolicyPublisher({ apiKey: 'policy.test', orgId, fetch: fetcher });
    await expect(publisher.publish(proposed)).rejects.toThrow('Existing named policy differs');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('has explicit action scopes and no approval for unknown or untrusted assertions', () => {
    const bundle = RaidRumblePolicy.bundle(orgId, bundleId, time);
    expect(bundle.policy_id).toBe('raidrumble');
    expect(bundle.required_signals).toContain('context.raidrumble.localReasonCodes[0]');
    const allowed = bundle.rules.filter((rule) => rule.then.action === 'AUTO_APPROVE');
    expect(allowed.length).toBeGreaterThanOrEqual(9);
    for (const rule of allowed) {
      const serialized = JSON.stringify(rule.when);
      expect(serialized).toContain('decision_type');
      expect(serialized).toContain('context.raidrumble.application');
      expect(serialized).toContain('context.raidrumble.localVerdict');
      expect(serialized).toContain('context.raidrumble.localReasonCodes');
    }
    expect(
      bundle.rules.find((rule) => rule.rule_id === 'raidrumble_unrecognized')?.then.action,
    ).toBe('AUTO_REJECT');
    expect(
      bundle.rules.find((rule) => rule.rule_id === 'raidrumble_local_block')?.priority,
    ).toBeGreaterThan(Math.max(...allowed.map((rule) => rule.priority)));
  });
});
