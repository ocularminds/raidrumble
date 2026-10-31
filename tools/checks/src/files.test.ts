import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', 'coverage', '__snapshots__'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : /\.(ts|css|html|py)$/.test(entry.name)
        ? [path]
        : [];
  });
}

describe('repository conventions', () => {
  it('keeps authored source paths short and free of hyphens', () => {
    const paths = ['apps', 'packages', 'tools'].flatMap((dir) => sources(join(root, dir)));
    expect(paths.filter((path) => relative(root, path).includes('-'))).toEqual([]);
  });

  it('keeps each authored source file within 500 lines', () => {
    const paths = ['apps', 'packages', 'tools'].flatMap((dir) => sources(join(root, dir)));
    const oversized = paths.filter(
      (path) => readFileSync(path, 'utf8').trimEnd().split('\n').length > 500,
    );
    expect(oversized.map((path) => relative(root, path))).toEqual([]);
  });
});
