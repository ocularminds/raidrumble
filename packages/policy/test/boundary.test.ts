import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WriteBoundary } from '../src/boundary.js';

const boundary = new WriteBoundary();

describe('Twitch side-effect boundary', () => {
  it.each([
    "helix.post('/chat/messages', body)",
    "this.helix['delete']('/rewards')",
    "const api = helix; api.patch('/rewards', body)",
    "const { post: send } = helix; send('/chat/messages', body)",
    "import { sendChatMessage as send } from '@raidrumble/twitch'; send(body)",
    "import { Helix as Client } from '@raidrumble/twitch'; const api = new Client(); api.post('/chat/messages')",
    "fetch('https://api.twitch.tv/helix/chat/messages', {method:'POST'})",
    "const base = 'https://api.twitch.tv/helix'; fetch(base + '/chat/messages', {method:'POST'})",
  ])('rejects %s outside the executor', (source) => {
    expect(boundary.inspect('apps/server/src/bad.ts', source).length).toBeGreaterThan(0);
  });

  it('allows reads, descriptors, route registration and the real executor', () => {
    expect(
      boundary.inspect(
        'apps/server/src/routes.ts',
        "app.post('/sim', handler); helix.get('/users')",
      ),
    ).toEqual([]);
    expect(
      boundary.inspect(
        'packages/twitch/src/writes.ts',
        "export const request = { method: 'POST', path: '/chat/messages' }",
      ),
    ).toEqual([]);
    expect(
      boundary.inspect('packages/policy/src/executor.ts', "helix.post('/chat/messages', body)"),
    ).toEqual([]);
    expect(
      boundary.inspect(
        'packages/twitch/src/read.ts',
        "fetch('https://api.twitch.tv/helix/users', {method:'GET'})",
      ),
    ).toEqual([]);
  });

  it('checks all authored app, package and simulator source files', async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
    const files: string[] = [];
    async function walk(path: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(path, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (['node_modules', 'dist', 'coverage', 'test', 'tests'].includes(entry.name)) continue;
        const target = join(path, entry.name);
        if (entry.isDirectory()) await walk(target);
        else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name))
          files.push(target);
      }
    }
    for (const folder of ['apps', 'packages', 'tools']) await walk(join(root, folder));
    const violations = (
      await Promise.all(
        files.map(async (file) =>
          boundary.inspect(relative(root, file), await readFile(file, 'utf8')),
        ),
      )
    ).flat();
    expect(violations).toEqual([]);
  });
});
