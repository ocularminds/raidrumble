type Family =
  'arcade' | 'shooter' | 'fantasy' | 'strategy' | 'sandbox' | 'creative' | 'social' | 'sports';

interface Theme {
  readonly adjective: string;
  readonly noun: string;
  readonly family: Family;
}

/** Authored genre vocabulary, not claims about individual streamers. */
const entries: readonly [string, string, string, Family][] = [
  ['Just Chatting', 'Talkative', 'Storyteller', 'social'],
  ['Fortnite', 'Stormforged', 'Builder', 'shooter'],
  ['League of Legends', 'Runic', 'Champion', 'strategy'],
  ['VALORANT', 'Radiant', 'Sentinel', 'shooter'],
  ['Grand Theft Auto V', 'Neon', 'Outlaw', 'social'],
  ['Counter-Strike 2', 'Tactical', 'Guardian', 'shooter'],
  ['Minecraft', 'Blockborn', 'Golem', 'sandbox'],
  ['World of Warcraft', 'Mythic', 'Warden', 'fantasy'],
  ['Dota 2', 'Arcane', 'Titan', 'strategy'],
  ['Apex Legends', 'Skybound', 'Hunter', 'shooter'],
  ['Escape from Tarkov', 'Armored', 'Marauder', 'shooter'],
  ['Call of Duty: Warzone', 'Battleforged', 'Vanguard', 'shooter'],
  ['PUBG: BATTLEGROUNDS', 'Stormbound', 'Survivor', 'shooter'],
  ['Rocket League', 'Turbo', 'Striker', 'sports'],
  ['EA Sports FC 26', 'Golden', 'Striker', 'sports'],
  ['Overwatch 2', 'Heroic', 'Sentinel', 'shooter'],
  ['Diablo IV', 'Infernal', 'Reaper', 'fantasy'],
  ['Hearthstone', 'Spellbound', 'Archivist', 'strategy'],
  ['Dead by Daylight', 'Shadowy', 'Stalker', 'fantasy'],
  ['Rust', 'Salvaged', 'Colossus', 'sandbox'],
  ['Destiny 2', 'Astral', 'Knight', 'shooter'],
  ['Final Fantasy XIV Online', 'Crystal', 'Summoner', 'fantasy'],
  ['Elden Ring', 'Gilded', 'Warden', 'fantasy'],
  ['Dark Souls III', 'Cinder', 'Knight', 'fantasy'],
  ['Street Fighter 6', 'Iron', 'Brawler', 'arcade'],
  ['Tekken 8', 'Electric', 'Champion', 'arcade'],
  ['Super Smash Bros. Ultimate', 'Starbound', 'Challenger', 'arcade'],
  ['Super Mario 64', 'Starlit', 'Jumper', 'arcade'],
  ['Animal Crossing: New Horizons', 'Island', 'Keeper', 'sandbox'],
  ['Stardew Valley', 'Verdant', 'Keeper', 'sandbox'],
  ['Terraria', 'Buried', 'Serpent', 'sandbox'],
  ["Baldur's Gate 3", 'Runic', 'Oracle', 'fantasy'],
  ['Path of Exile', 'Exiled', 'Juggernaut', 'fantasy'],
  ['Genshin Impact', 'Elemental', 'Wanderer', 'fantasy'],
  ['Honkai: Star Rail', 'Cosmic', 'Navigator', 'fantasy'],
  ['Music', 'Harmonic', 'Bard', 'creative'],
  ['Art', 'Chromatic', 'Sculptor', 'creative'],
  ['Science & Technology', 'Electric', 'Inventor', 'creative'],
  ['Software and Game Development', 'Clockwork', 'Architect', 'creative'],
  ['Makers & Crafting', 'Forged', 'Artisan', 'creative'],
  ['Food & Drink', 'Sizzling', 'Chef', 'creative'],
  ['Gardening', 'Blooming', 'Gardener', 'creative'],
  ['Speedrunning', 'Speedrun', 'Sprinter', 'arcade'],
  ['Retro', 'Pixel', 'Golem', 'arcade'],
  ['Sports', 'Dynamic', 'Champion', 'sports'],
  ['ASMR', 'Whispering', 'Dreamer', 'social'],
  ['Chess', 'Calculating', 'Grandmaster', 'strategy'],
  ['IRL', 'Roaming', 'Explorer', 'social'],
];

const families: Readonly<Record<Family, readonly string[]>> = {
  arcade: ['Retro', 'Platformer', 'Speedrunning', 'Super Mario 64'],
  shooter: ['VALORANT', 'Counter-Strike 2', 'Fortnite', 'Apex Legends'],
  fantasy: ['World of Warcraft', 'Final Fantasy XIV Online', 'Elden Ring', 'Diablo IV'],
  strategy: ['Dota 2', 'League of Legends', 'Hearthstone', 'Chess'],
  sandbox: ['Minecraft', 'Terraria', 'Stardew Valley', 'Animal Crossing: New Horizons'],
  creative: ['Makers & Crafting', 'Art', 'Food & Drink', 'Gardening'],
  social: ['Just Chatting', 'IRL', 'Music', 'ASMR'],
  sports: ['Sports', 'Rocket League', 'EA Sports FC 26', 'Chess'],
};

export const categoryKey = (value: string): string =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

const themes: ReadonlyMap<string, Theme> = new Map(
  entries.map(([name, adjective, noun, family]) => [
    categoryKey(name),
    { adjective, noun, family },
  ]),
);

export function categoryTheme(category: string): Theme | undefined {
  return themes.get(categoryKey(category));
}

export function similarCategories(category: string): readonly string[] {
  const theme = categoryTheme(category);
  return theme ? families[theme.family] : ['Just Chatting', 'Retro', 'Art', 'Music'];
}
