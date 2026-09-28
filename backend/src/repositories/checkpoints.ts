import type Database from 'better-sqlite3';
import type { Checkpoint } from '@agy-studio/contracts';

interface CheckpointRow {
  id: string;
  workspace_id: string;
  session_id: string;
  run_id: string;
  commit_sha: string;
  files_changed: number | null;
  created_at: string;
}

function toDomain(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    runId: row.run_id,
    commitSha: row.commit_sha,
    filesChanged: row.files_changed,
    createdAt: row.created_at,
  };
}

export class CheckpointsRepository {
  constructor(private readonly db: Database.Database) {}

  create(checkpoint: Checkpoint): Checkpoint {
    this.db
      .prepare(
        `INSERT INTO checkpoints (
          id, workspace_id, session_id, run_id, commit_sha, files_changed, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        checkpoint.id,
        checkpoint.workspaceId,
        checkpoint.sessionId,
        checkpoint.runId,
        checkpoint.commitSha,
        checkpoint.filesChanged ?? null,
        checkpoint.createdAt,
      );
    return checkpoint;
  }

  findById(id: string): Checkpoint | null {
    const row = this.db
      .prepare('SELECT * FROM checkpoints WHERE id = ?')
      .get(id) as CheckpointRow | undefined;
    return row ? toDomain(row) : null;
  }

  findByRunId(runId: string): Checkpoint | null {
    const row = this.db
      .prepare('SELECT * FROM checkpoints WHERE run_id = ?')
      .get(runId) as CheckpointRow | undefined;
    return row ? toDomain(row) : null;
  }

  listBySessionId(sessionId: string): Checkpoint[] {
    const rows = this.db
      .prepare('SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId) as CheckpointRow[];
    return rows.map(toDomain);
  }

  listByWorkspaceId(workspaceId: string): Checkpoint[] {
    const rows = this.db
      .prepare('SELECT * FROM checkpoints WHERE workspace_id = ? ORDER BY created_at DESC')
      .all(workspaceId) as CheckpointRow[];
    return rows.map(toDomain);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM checkpoints WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
