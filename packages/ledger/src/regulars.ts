import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

/** Separate privacy-limited signal store: per-host salted hashes, never raw viewer IDs. */
export class RegularStore {
  private readonly database: Database.Database;
  private readonly streams = new Map<string, string>();
  private readonly session = randomUUID();

  constructor(path = ':memory:') {
    this.database = new Database(path);
    this.database.pragma('journal_mode = WAL');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS salts (host_id TEXT PRIMARY KEY,salt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS regulars (
        host_id TEXT NOT NULL,hash TEXT NOT NULL,first_stream TEXT NOT NULL,last_stream TEXT NOT NULL,
        PRIMARY KEY(host_id,hash)
      );
    `);
  }

  beginStream(hostId: string, streamId: string): void {
    if (!hostId || !streamId)
      throw new Error('A regular signal requires host and stream identity.');
    this.streams.set(hostId, streamId);
  }

  has(hostId: string, userId: string): boolean {
    const salt = this.salt(hostId);
    if (!salt) return false;
    const row = this.database
      .prepare<[string, string], { first_stream: string }>(
        'SELECT first_stream FROM regulars WHERE host_id=? AND hash=?',
      )
      .get(hostId, this.hash(salt, userId));
    return row !== undefined && row.first_stream !== this.stream(hostId);
  }

  observe(hostId: string, userId: string): void {
    if (!hostId || !userId) return;
    this.database.transaction(() => {
      let salt = this.salt(hostId);
      if (!salt) {
        salt = randomBytes(32).toString('hex');
        this.database.prepare('INSERT INTO salts(host_id,salt) VALUES(?,?)').run(hostId, salt);
      }
      const stream = this.stream(hostId);
      this.database
        .prepare(
          `INSERT INTO regulars(host_id,hash,first_stream,last_stream) VALUES(?,?,?,?)
        ON CONFLICT(host_id,hash) DO UPDATE SET last_stream=excluded.last_stream`,
        )
        .run(hostId, this.hash(salt, userId), stream, stream);
    })();
  }

  close(): void {
    if (this.database.open) this.database.close();
  }

  private salt(hostId: string): string | undefined {
    return this.database
      .prepare<[string], { salt: string }>('SELECT salt FROM salts WHERE host_id=?')
      .get(hostId)?.salt;
  }

  private stream(hostId: string): string {
    return this.streams.get(hostId) ?? this.session;
  }
  private hash(salt: string, userId: string): string {
    return createHmac('sha256', salt).update(userId).digest('hex');
  }
}
