import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { RegularStore } from '../src/regulars.js';
import { databasePath, track } from './fixture.js';

describe('salted regular signals', () => {
  it('only treats a viewer as a regular after a previous stream', () => {
    const store = track(new RegularStore());
    store.beginStream('host', 'stream1');
    store.observe('host', 'viewer');
    expect(store.has('host', 'viewer')).toBe(false);
    store.beginStream('host', 'stream2');
    expect(store.has('host', 'viewer')).toBe(true);
    store.observe('host', 'viewer');
    expect(store.has('host', 'viewer')).toBe(true);
    expect(store.has('otherHost', 'viewer')).toBe(false);
  });

  it('persists only a different salted hash per host, never the raw viewer id', () => {
    const path = databasePath();
    const store = track(new RegularStore(path));
    store.observe('host', 'privateViewerId');
    store.observe('other', 'privateViewerId');
    const database = track(new Database(path));
    const rows = database.prepare('SELECT hash FROM regulars ORDER BY host_id').all() as {
      hash: string;
    }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.hash).not.toBe(rows[1]?.hash);
    expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.hash))).toBe(true);
    expect(JSON.stringify(database.prepare('SELECT * FROM regulars').all())).not.toContain(
      'privateViewerId',
    );
    store.close();
    const reopened = track(new RegularStore(path));
    expect(reopened.has('host', 'privateViewerId')).toBe(true);
  });
});
