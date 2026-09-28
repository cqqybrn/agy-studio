import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../utils/config.js';
import { runMigrations } from './migrations.js';

export interface DatabaseOptions {
  dbPath?: string;
  runMigrations?: boolean;
}

export function createDatabase(options?: DatabaseOptions | string): Database.Database {
  const opts: DatabaseOptions =
    typeof options === 'string' ? { dbPath: options } : options ?? {};

  const dbPath = opts.dbPath ?? path.join(getConfig().dataDir, 'studio.db');

  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);

  // WAL mode for concurrency, 5000ms busy timeout, and enforce foreign keys
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  if (opts.runMigrations !== false) {
    runMigrations(db);
  }

  return db;
}
