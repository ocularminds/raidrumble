import type { Answer, ContentPack, Question } from '@raidrumble/engine';
import type { Channels, Selection } from './model.js';
import { display } from './model.js';
import { bossFrom } from './boss.js';
import { categoryKey, similarCategories } from './categories.js';

export const demoChannels: Channels = {
  host: {
    id: 'demo',
    name: 'Mossy',
    category: 'Gardening',
    title: 'Growing a tiny jungle',
    tags: ['Cozy', 'Plants'],
    facts: ['Every stream ends with a plant check.', 'My first plant was a fern.'],
  },
  raider: {
    id: 'pixel',
    name: 'PixelPilot',
    category: 'Speedrunning',
    title: 'One more personal best',
    tags: ['Speedrun', 'Community'],
    facts: ['Chat chooses the next challenge.', 'Friday is community race day.'],
  },
};

export function safeContent(): ContentPack {
  return {
    siegeKeywords: ['PUSH', 'HOLD', 'RALLY', 'CHARGE', 'DEFEND', 'UNITE'],
    weakPoints: ['SPARK', 'BLOOM', 'BURST', 'COMBO', 'SHINE', 'UNITE'],
    boss: { name: 'The Fusion Guardian', flavour: 'Built from two worlds. Beaten together.' },
    questions: [
      {
        id: 'safe0',
        about: 'host',
        prompt: 'Which team belongs to the host?',
        choices: ['Home Guard ●', 'Raiders ▲', 'The boss'],
        answer: 'A',
      },
      {
        id: 'safe1',
        about: 'raider',
        prompt: 'Which shape marks the visiting Raiders?',
        choices: ['Circle ●', 'Triangle ▲', 'Square ■'],
        answer: 'B',
      },
      {
        id: 'safe2',
        about: 'host',
        prompt: 'What does the Home Guard protect in Siege?',
        choices: ['A spaceship', 'A trophy', 'The gate'],
        answer: 'C',
      },
      {
        id: 'safe3',
        about: 'raider',
        prompt: 'Who fights the Fusion Boss?',
        choices: ['Both communities', 'Only Raiders', 'Only Home Guard'],
        answer: 'A',
      },
    ],
  };
}

export function questionFrom(channels: Channels, selection: Selection, index: number): Question {
  const profile = channels[selection.about];
  const other = channels[selection.about === 'host' ? 'raider' : 'host'];
  let value: string;
  let prompt: string;
  let distractors: string[];
  const name =
    display(profile.name, 32) || (selection.about === 'host' ? 'the host' : 'the raider');
  if (selection.kind === 'fact') {
    const ownFacts = profile.facts.slice(0, 3).map((fact) => display(fact));
    value = ownFacts[selection.factIndex] ?? '';
    prompt = `Which fact did ${name} share about their stream?`;
    distractors = distinct(other.facts.slice(0, 3), ownFacts);
    if (!value || distractors.length < 2)
      return questionFrom(channels, { ...selection, kind: 'category' }, index);
  } else {
    // Two channels cannot supply three distinct known titles. Use category evidence instead
    // of inventing another person's title or filling an option with a placeholder.
    value = display(profile.category, 70);
    prompt = `What is ${name} streaming right now?`;
    distractors = distinct([display(other.category, 70), ...similarCategories(value)], [value]);
  }
  if (!value) return safeContent().questions[index] ?? safeContent().questions[0]!;
  const choices: [string, string, string] = [value, distractors[0]!, distractors[1]!];
  const slot = index % 3;
  [choices[0], choices[slot]] = [choices[slot]!, choices[0]];
  return {
    id: `question${index}`,
    about: selection.about,
    prompt,
    choices,
    answer: (['A', 'B', 'C'] as const)[slot] as Answer,
    explanation: value,
  };
}

export function channelTemplates(channels: Channels): ContentPack {
  return {
    ...safeContent(),
    boss: bossFrom(channels),
    questions: [
      questionFrom(channels, { about: 'host', kind: 'category', factIndex: 0 }, 0),
      questionFrom(channels, { about: 'raider', kind: 'category', factIndex: 0 }, 1),
      questionFrom(
        channels,
        { about: 'host', kind: channels.host.facts.length ? 'fact' : 'title', factIndex: 0 },
        2,
      ),
      questionFrom(
        channels,
        { about: 'raider', kind: channels.raider.facts.length ? 'fact' : 'title', factIndex: 0 },
        3,
      ),
    ],
  };
}

function distinct(candidates: readonly string[], excluded: readonly string[]): string[] {
  const seen = new Set(excluded.map(categoryKey));
  return candidates
    .map((candidate) => display(candidate))
    .filter((candidate) => {
      const key = categoryKey(candidate);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
