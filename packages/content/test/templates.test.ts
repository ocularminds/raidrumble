import { describe, expect, it } from 'vitest';
import { channelTemplates, demoChannels, questionFrom, safeContent } from '../src/templates.js';
import type { Channels } from '../src/model.js';

const answer = (question: ReturnType<typeof questionFrom>) =>
  question.choices[(['A', 'B', 'C'] as const).indexOf(question.answer)];
const channels = (host: string, raider: string): Channels => ({
  host: { ...demoChannels.host, category: host },
  raider: { ...demoChannels.raider, category: raider },
});

describe('plausible factual quiz choices', () => {
  it('combines the other channel category with a related curated category', () => {
    const question = questionFrom(
      demoChannels,
      { about: 'raider', kind: 'category', factIndex: 0 },
      1,
    );
    expect(answer(question)).toBe('Speedrunning');
    expect(question.choices).toContain('Gardening');
    expect(question.choices.some((choice) => ['Retro', 'Platformer'].includes(choice))).toBe(true);
    expect(question.choices.join(' ')).not.toMatch(/Not shared|Something else|Option two|Neither/);
  });

  it('deduplicates categories without case or spacing creating fake alternatives', () => {
    const question = questionFrom(
      channels('Speedrunning', ' SPEEDRUNNING '),
      {
        about: 'host',
        kind: 'category',
        factIndex: 0,
      },
      0,
    );
    expect(answer(question)).toBe('Speedrunning');
    expect(new Set(question.choices.map((choice) => choice.toLowerCase()))).toHaveProperty(
      'size',
      3,
    );
    expect(question.choices).toContain('Retro');
    expect(question.choices).toContain('Platformer');
  });

  it('uses only supplied facts from the other channel as personal-fact distractors', () => {
    const question = questionFrom(demoChannels, { about: 'host', kind: 'fact', factIndex: 0 }, 2);
    expect(answer(question)).toBe(demoChannels.host.facts[0]);
    expect(question.choices).toEqual(expect.arrayContaining([...demoChannels.raider.facts]));
    expect(question.choices).not.toContain(demoChannels.host.facts[1]);
    expect(question.explanation).toBe(demoChannels.host.facts[0]);
  });

  it('uses a factual category question when two safe distinct fact alternatives are unavailable', () => {
    const pair: Channels = {
      host: { ...demoChannels.host, facts: ['I grow plants.'] },
      raider: { ...demoChannels.raider, facts: ['I grow plants.'] },
    };
    const question = questionFrom(pair, { about: 'host', kind: 'fact', factIndex: 0 }, 2);
    expect(answer(question)).toBe('Gardening');
    expect(question.prompt).toContain('streaming right now');
    expect(question.choices.join(' ')).not.toMatch(/fact|Not shared|Something else/);
  });

  it('never invents a third personal stream title when only two titles are known', () => {
    const question = questionFrom(demoChannels, { about: 'host', kind: 'title', factIndex: 0 }, 0);
    expect(answer(question)).toBe('Gardening');
    expect(question.prompt).toContain('streaming right now');
  });

  it('keeps missing metadata renderable with authored game rules', () => {
    const pair = channels('', '');
    pair.host.title = '';
    pair.host.facts = [];
    const question = questionFrom(pair, { about: 'host', kind: 'category', factIndex: 0 }, 0);
    expect(question).toEqual(safeContent().questions[0]);
  });
});

describe('category-based boss names', () => {
  it.each([
    ['Gardening', 'Speedrunning', 'The Speedrun Gardener'],
    ['Speedrunning', 'Gardening', 'The Blooming Sprinter'],
    ['Just Chatting', 'Fortnite', 'The Stormforged Storyteller'],
    ['Minecraft', 'VALORANT', 'The Radiant Golem'],
    ['Art', 'Music', 'The Harmonic Sculptor'],
    ['World of Warcraft', 'Chess', 'The Calculating Warden'],
    ['Food & Drink', 'Rocket League', 'The Turbo Chef'],
    ['Software and Game Development', 'Science & Technology', 'The Electric Architect'],
  ])('themes %s × %s through the same category mapping', (host, raider, expected) => {
    const content = channelTemplates(channels(host, raider));
    expect(content.boss.name).toBe(expected);
    expect(content).toEqual(channelTemplates(channels(host, raider)));
    expect(content.boss.name.length).toBeLessThanOrEqual(60);
  });

  it('matches categories regardless of casing and whitespace', () => {
    expect(channelTemplates(channels(' just chatting ', 'FORTNITE')).boss.name).toBe(
      'The Stormforged Storyteller',
    );
  });

  it('falls back to the supplied raider category and a host noun without concatenating categories', () => {
    expect(channelTemplates(channels('Gardening', 'Unlisted Adventures')).boss.name).toBe(
      'The Unlisted Adventures Gardener',
    );
    expect(channelTemplates(channels('Unlisted Host Category', 'Fortnite')).boss.name).toBe(
      'The Stormforged Guardian',
    );
    expect(channelTemplates(channels('', '')).boss.name).toBe('The Fusion Guardian');
  });
});
