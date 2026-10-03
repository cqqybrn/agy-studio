import type Database from 'better-sqlite3';
import type { ApiErrorBody, Run, RunStatus, TokenUsage } from '@agy-studio/contracts';

export interface RunRecord extends Run {
  pid?: number | null;
}

interface RunRow {
  id: string;
  session_id: string;
  status: RunStatus;
  model: string | null;
  account_name: string | null;
  pid: number | null;
  usage_json: string | null;
  error_json: string | null;
  started_at: string;
  ended_at: string | null;
}

const NON_TERMINAL_STATUSES: RunStatus[] = ['queued', 'starting', 'running', 'stalled'];

function toDomain(row: RunRow): RunRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    model: row.model,
    accountName: row.account_name,
    pid: row.pid ?? null,
    usage: row.usage_json ? (JSON.parse(row.usage_json) as TokenUsage) : null,
    error: row.error_json ? (JSON.parse(row.error_json) as ApiErrorBody) : null,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export class RunsRepository {
  constructor(private readonly db: Database.Database) {}

  create(run: RunRecord): RunRecord {
    this.db
      .prepare(
        `INSERT INTO runs (
          id, session_id, status, model, account_name,
          pid, usage_json, error_json, started_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.sessionId,
        run.status,
        run.model ?? null,
        run.accountName ?? null,
        run.pid ?? null,
        run.usage ? JSON.stringify(run.usage) : null,
        run.error ? JSON.stringify(run.error) : null,
        run.startedAt,
        run.endedAt ?? null,
      );
    return run;
  }

  findById(id: string): RunRecord | null {
    const row = this.db
      .prepare('SELECT * FROM runs WHERE id = ?')
      .get(id) as RunRow | undefined;
    return row ? toDomain(row) : null;
  }

  listBySessionId(sessionId: string): RunRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM runs WHERE session_id = ? ORDER BY started_at ASC')
      .all(sessionId) as RunRow[];
    return rows.map(toDomain);
  }

  listNonTerminal(): RunRecord[] {
    const placeholders = NON_TERMINAL_STATUSES.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM runs WHERE status IN (${placeholders}) ORDER BY started_at ASC`)
      .all(...NON_TERMINAL_STATUSES) as RunRow[];
    return rows.map(toDomain);
  }

  update(
    id: string,
    patch: Partial<Omit<RunRecord, 'id' | 'sessionId' | 'startedAt'>>,
  ): RunRecord | null {
    const current = this.findById(id);
    if (!current) return null;

    const updated: RunRecord = {
      ...current,
      ...patch,
    };

    this.db
      .prepare(
        `UPDATE runs
         SET status = ?, model = ?, account_name = ?,
             pid = ?, usage_json = ?, error_json = ?, ended_at = ?
         WHERE id = ?`,
      )
      .run(
        updated.status,
        updated.model ?? null,
        updated.accountName ?? null,
        updated.pid ?? null,
        updated.usage ? JSON.stringify(updated.usage) : null,
        updated.error ? JSON.stringify(updated.error) : null,
        updated.endedAt ?? null,
        id,
      );

    return updated;
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM runs WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
