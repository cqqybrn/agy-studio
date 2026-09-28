import type Database from 'better-sqlite3';
import type { Prefs } from '@agy-studio/contracts';

interface PrefRow {
  key: string;
  value_json: string;
}

export const DEFAULT_PREFS: Prefs = {
  defaultModel: null,
  defaultEffort: null,
  defaultMode: null,
  defaultWorkspaceId: null,
  showThinking: true,
  checkpointsEnabled: true,
  maxConcurrentRuns: 3,
  stallTimeoutSeconds: 180,
};

export class PrefsRepository {
  constructor(private readonly db: Database.Database) {}

  get(): Prefs {
    const rows = this.db.prepare('SELECT key, value_json FROM prefs').all() as PrefRow[];
    const result: Partial<Prefs> = {};

    for (const row of rows) {
      try {
        (result as Record<string, unknown>)[row.key] = JSON.parse(row.value_json);
      } catch {
        // ignore malformed rows
      }
    }

    return {
      ...DEFAULT_PREFS,
      ...result,
    };
  }

  update(patch: Partial<Prefs>): Prefs {
    const tx = this.db.transaction(() => {
      const stmt = this.db.prepare(
        `INSERT INTO prefs (key, value_json)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
      );

      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) {
          stmt.run(key, JSON.stringify(value));
        }
      }
    });

    tx();
    return this.get();
  }

  reset(): Prefs {
    this.db.prepare('DELETE FROM prefs').run();
    return { ...DEFAULT_PREFS };
  }
}
