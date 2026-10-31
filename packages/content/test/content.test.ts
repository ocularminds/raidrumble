import { describe, expect, it } from 'vitest';
import { LocalPolicyGate, defaultPolicy } from '@raidrumble/policy';
import { ContentService } from '../src/service.js';
import { demoChannels, safeContent } from '../src/templates.js';

function gate(blockedTerms: string[] = []) {
  const config = defaultPolicy();
  config.lists.blockedTerms = blockedTerms;
  return new LocalPolicyGate(config, { logger: () => undefined });
}

describe('gated content with factual provenance', () => {
  it('renders four deterministic questions without an API account', async () => {
    const service = new ContentService(gate());
    const content = await service.create(demoChannels);
    expect(content.questions).toHaveLength(4);
    expect(content.questions.map((question) => question.about)).toEqual([
      'host',
      'raider',
      'host',
      'raider',
    ]);
    expect(content.questions[0]?.choices).toContain(demoChannels.host.category);
    expect(content).toEqual(await service.create(demoChannels));
  });

  it('replaces blocked generated text with a safe template even in shadow mode', async () => {
    const policy = gate(['forbidden']);
    const service = new ContentService(policy, {
      generate: async () => ({
        selections: [],
        boss: { name: 'forbidden boss', flavour: 'A challenger.' },
      }),
    });
    const content = await service.create(demoChannels);
    expect(JSON.stringify(content)).not.toContain('forbidden');
    expect(content.boss.name).toBe('The Fusion Guardian');
    expect(policy.listRecords().some((decision) => decision.verdict === 'BLOCK')).toBe(true);
  });

  it('does not let a model add invented personal facts to questions', async () => {
    const service = new ContentService(gate(), {
      generate: async () => ({
        selections: [{ about: 'host', kind: 'fact', factIndex: 88, text: 'invented' }],
        boss: { name: 'A Boss', flavour: 'A challenge.' },
      }),
    });
    const content = await service.create(demoChannels);
    expect(JSON.stringify(content.questions)).not.toContain('invented');
    expect(content.questions).toHaveLength(4);
  });

  it('does not reintroduce blocked terms through template interpolation', async () => {
    const channels = {
      ...demoChannels,
      host: { ...demoChannels.host, name: 'forbidden', category: 'forbidden' },
    };
    const service = new ContentService(gate(['forbidden']));
    const content = await service.create(channels);
    expect(JSON.stringify(content)).not.toContain('forbidden');
    expect(content.questions[0]).toEqual(safeContent().questions[0]);
    expect(await service.name('forbidden', 'demo')).toBe('Viewer');
  });

  it('keeps the game renderable after generator errors or timeouts', async () => {
    const throws = new ContentService(gate(), {
      generate: async () => {
        throw new Error('offline');
      },
    });
    const hangs = new ContentService(gate(), { generate: () => new Promise(() => undefined) }, 5);
    expect((await throws.create(demoChannels)).questions).toHaveLength(4);
    expect((await hangs.create(demoChannels)).questions).toHaveLength(4);
  });

  it('falls back when the moderation checker flags generated content', async () => {
    const service = new ContentService(gate(), {
      generate: async () => ({
        selections: [],
        boss: { name: 'Flagged creature', flavour: 'Flagged.' },
      }),
      flagged: async () => true,
    });
    expect((await service.create(demoChannels)).boss).toEqual(safeContent().boss);
  });
});
