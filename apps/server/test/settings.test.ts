import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../src/services/settings.js';

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
const legacy = {
  allow: ['friend'],
  block: [],
  blockedTerms: [],
  facts: [],
  mode: 'enforce' as const,
  reducedMotion: false,
};

function path(): string {
  const directory = mkdtempSync(join(tmpdir(), 'raidrumble.'));
  directories.push(directory);
  return join(directory, 'settings.json');
}

describe('stored presentation preferences', () => {
  it('loads older settings with safe defaults and persists explicit new preferences', () => {
    const file = path();
    writeFileSync(file, JSON.stringify({ host: legacy }));
    const store = new SettingsStore(file);
    expect(store.get('host')).toMatchObject({ layout: 'lower', sound: false });
    store.set('host', { ...legacy, layout: 'full', sound: true });
    expect(new SettingsStore(file).get('host')).toMatchObject({
      layout: 'full',
      sound: true,
      allow: ['friend'],
    });
  });

  it('returns copies so UI reads cannot mutate another preference update', () => {
    const store = new SettingsStore();
    store.set('host', legacy);
    const copy = store.get('host')!;
    (copy.allow as string[]).push('unapproved');
    copy.layout = 'rail';
    expect(store.get('host')).toMatchObject({ allow: ['friend'], layout: 'lower' });
  });

  it('rejects malformed optional values without discarding valid neighboring channels', () => {
    const file = path();
    writeFileSync(
      file,
      JSON.stringify({ valid: legacy, bad: { ...legacy, layout: ['rail'], sound: true } }),
    );
    const store = new SettingsStore(file);
    expect(store.get('valid')).toBeDefined();
    expect(store.get('bad')).toBeUndefined();
  });
});
