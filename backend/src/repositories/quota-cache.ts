import type Database from 'better-sqlite3';
import type { QuotaSnapshot, QuotaSource } from '@agy-studio/contracts';

interface QuotaCacheRow {
  account_name: string;
  source: QuotaSource;
  snapshot_json: string;
  fetched_at: string;
}

export interface QuotaCacheRecord {
  accountName: string;
  source: QuotaSource;
  snapshot: QuotaSnapshot;
  fetchedAt: string;
}

function toDomain(row: QuotaCacheRow): QuotaCacheRecord {
  return {
    accountName: row.account_name,
    source: row.source,
    snapshot: JSON.parse(row.snapshot_json) as QuotaSnapshot,
    fetchedAt: row.fetched_at,
  };
}

export class QuotaCacheRepository {
  constructor(private readonly db: Database.Database) {}

  set(accountName: string, source: QuotaSource, snapshot: QuotaSnapshot, fetchedAt?: string): void {
    const ts = fetchedAt ?? snapshot.fetchedAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO quota_cache (account_name, source, snapshot_json, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(account_name, source) DO UPDATE SET
           snapshot_json = excluded.snapshot_json,
           fetched_at = excluded.fetched_at`,
      )
      .run(accountName, source, JSON.stringify(snapshot), ts);
  }

  get(accountName: string, source: QuotaSource): QuotaCacheRecord | null {
    const row = this.db
      .prepare('SELECT * FROM quota_cache WHERE account_name = ? AND source = ?')
      .get(accountName, source) as QuotaCacheRow | undefined;
    return row ? toDomain(row) : null;
  }

  listByAccount(accountName: string): QuotaCacheRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM quota_cache WHERE account_name = ? ORDER BY fetched_at DESC')
      .all(accountName) as QuotaCacheRow[];
    return rows.map(toDomain);
  }

  deleteByAccount(accountName: string): number {
    const result = this.db
      .prepare('DELETE FROM quota_cache WHERE account_name = ?')
      .run(accountName);
    return result.changes;
  }

  clear(): void {
    this.db.prepare('DELETE FROM quota_cache').run();
  }
}
