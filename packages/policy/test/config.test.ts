import { describe, expect, it } from 'vitest';
import { parsePolicy, loadPolicy } from '../src/config.js';
import { defaultPolicy } from '../src/defaults.js';
import { LocalPolicyGate } from '../src/local.js';
import { request } from './helpers.js';

describe('tiny YAML policy loader', () => {
  it('loads the repository policy with all governed actions', async () => {
    const policy = await loadPolicy(
      new URL('../../../policy/raidrumble.policy.yaml', import.meta.url),
    );
    expect(policy.defaults).toEqual({ mode: 'shadow', latencyBudgetMs: 120 });
    expect(Object.keys(policy.actions)).toHaveLength(9);
  });

  it('honors configured lists, parameters and fixed predicates', async () => {
    const config = parsePolicy(`
version: 1
defaults: { mode: enforce, latencyBudgetMs: 120 }
lists: { allow: [visitor], block: [], blockedTerms: [] }
params: { minRaidSize: 40 }
`);
    const gate = new LocalPolicyGate(config, { logger: () => undefined });
    expect((await gate.authorize(request())).reasonCodes).toContain('RAID_TOO_SMALL');
    expect(defaultPolicy().lists.allow).toEqual([]);
  });

  it('rejects arbitrary expressions, unsafe keys and invalid timeouts', () => {
    expect(() =>
      parsePolicy(
        'version: 1\nactions:\n  rumble.start:\n    allow: [{ when: "process.exit()", reason: BAD }]',
      ),
    ).toThrow('predicate');
    expect(() => parsePolicy('version: 1\ndefaults: { latencyBudgetMs: 0 }')).toThrow();
    expect(() => parsePolicy('version: 2')).toThrow('version');
    expect(() => parsePolicy('version: 1\nparams: { minRaidSize: -2 }')).toThrow();
    expect(() => parsePolicy('version: 1\nactions: { made.up: {} }')).toThrow('action');
  });
});
