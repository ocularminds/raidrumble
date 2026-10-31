import type { Answer, ContentPack, Question } from '@raidrumble/engine';
import type { Channels, Selection } from './model.js';
import { display } from './model.js';

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
  let alternate: string;
  const name =
    display(profile.name, 32) || (selection.about === 'host' ? 'the host' : 'the raider');
  if (selection.kind === 'fact') {
    value = display(profile.facts.slice(0, 3)[selection.factIndex] ?? '');
    prompt = `Which fact did ${name} share about their stream?`;
    alternate = display(other.facts[0] ?? 'No fact was shared');
  } else if (selection.kind === 'title') {
    value = display(profile.title, 100);
    prompt = `What is the title of ${name}’s stream?`;
    alternate = display(other.title, 100);
  } else {
    value = display(profile.category, 70);
    prompt = `What is ${name} streaming right now?`;
    alternate = display(other.category, 70);
  }
  if (!value) return safeContent().questions[index] ?? safeContent().questions[0]!;
  const distractors = [alternate, 'Not shared', 'Something else', 'Neither community'].filter(
    (text, i, all) => text && text !== value && all.indexOf(text) === i,
  );
  const choices: [string, string, string] = [
    value,
    distractors[0] ?? 'Option two',
    distractors[1] ?? 'Option three',
  ];
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
  const gardenRun =
    [channels.host.category, channels.raider.category].includes('Gardening') &&
    [channels.host.category, channels.raider.category].includes('Speedrunning');
  return {
    ...safeContent(),
    boss: {
      name: gardenRun
        ? 'The Speedrun Gardener'
        : display(`The ${channels.raider.category} ${channels.host.category} Guardian`, 60),
      flavour: gardenRun
        ? 'Speed meets growth. Bring both worlds together.'
        : 'A fusion of your two worlds. Find its weak point together.',
    },
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
