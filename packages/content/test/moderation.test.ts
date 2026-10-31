import { describe, expect, it, vi } from 'vitest';
import { OpenAiContent } from '../src/openai.js';

describe('moderation response validation', () => {
  it.each([{ results: [] }, { results: [{}] }, { results: [{ flagged: false }, {}] }, {}])(
    'does not treat missing moderation evidence as a clean result: %j',
    async (body) => {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
      const generator = new OpenAiContent('test', 'test', transport);
      expect(await generator.flagged('A generated boss')).toBe(true);
    },
  );

  it('accepts an explicit clean result and rejects a flagged one', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"results":[{"flagged":false}]}'))
      .mockResolvedValueOnce(new Response('{"results":[{"flagged":true}]}'));
    const generator = new OpenAiContent('test', 'test', transport);
    expect(await generator.flagged('A generated boss')).toBe(false);
    expect(await generator.flagged('Another boss')).toBe(true);
  });
});
