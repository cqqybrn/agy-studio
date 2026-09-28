import type Database from 'better-sqlite3';
import type { Workspace } from '@agy-studio/contracts';

interface WorkspaceRow {
  id: string;
  name: string;
  path: string;
  is_git_repo: number;
  created_at: string;
  last_opened_at: string;
}

function toDomain(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    isGitRepo: row.is_git_repo === 1,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
  };
}

export class WorkspacesRepository {
  constructor(private readonly db: Database.Database) {}

  create(workspace: Workspace): Workspace {
    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, path, is_git_repo, created_at, last_opened_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workspace.id,
        workspace.name,
        workspace.path,
        workspace.isGitRepo ? 1 : 0,
        workspace.createdAt,
        workspace.lastOpenedAt,
      );
    return workspace;
  }

  findById(id: string): Workspace | null {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE id = ?')
      .get(id) as WorkspaceRow | undefined;
    return row ? toDomain(row) : null;
  }

  findByPath(path: string): Workspace | null {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE path = ?')
      .get(path) as WorkspaceRow | undefined;
    return row ? toDomain(row) : null;
  }

  list(): Workspace[] {
    const rows = this.db
      .prepare('SELECT * FROM workspaces ORDER BY last_opened_at DESC, created_at DESC')
      .all() as WorkspaceRow[];
    return rows.map(toDomain);
  }

  update(
    id: string,
    patch: Partial<Pick<Workspace, 'name' | 'path' | 'isGitRepo' | 'lastOpenedAt'>>,
  ): Workspace | null {
    const current = this.findById(id);
    if (!current) return null;

    const updated: Workspace = {
      ...current,
      ...patch,
    };

    this.db
      .prepare(
        `UPDATE workspaces
         SET name = ?, path = ?, is_git_repo = ?, last_opened_at = ?
         WHERE id = ?`,
      )
      .run(
        updated.name,
        updated.path,
        updated.isGitRepo ? 1 : 0,
        updated.lastOpenedAt,
        id,
      );

    return updated;
  }

  touchLastOpened(id: string, timestamp?: string): Workspace | null {
    const ts = timestamp ?? new Date().toISOString();
    return this.update(id, { lastOpenedAt: ts });
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
