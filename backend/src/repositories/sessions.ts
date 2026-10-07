import type Database from 'better-sqlite3';
import type {
  AgentMode,
  Effort,
  Page,
  Session,
  SessionSource,
  SessionStatus,
} from '@agy-studio/contracts';

interface SessionRow {
  id: string;
  workspace_id: string;
  account_name: string | null;
  title: string;
  agy_conversation_id: string | null;
  status: SessionStatus;
  model: string | null;
  effort: Effort | null;
  mode: AgentMode | null;
  source: SessionSource;
  last_run_id: string | null;
  last_seq: number;
  created_at: string;
  updated_at: string;
  pinned_at: string | null;
}

function toDomain(row: SessionRow): Session {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountName: row.account_name,
    title: row.title,
    agyConversationId: row.agy_conversation_id,
    status: row.status,
    model: row.model,
    effort: row.effort,
    mode: row.mode,
    source: row.source,
    lastRunId: row.last_run_id,
    lastSeq: row.last_seq,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pinnedAt: row.pinned_at ?? null,
  };
}

export interface ListSessionsFilter {
  workspaceId?: string;
  cursor?: string;
  limit?: number;
}

function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt, id }), 'utf-8').toString('base64');
}

function decodeCursor(cursor: string): { updatedAt: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.updatedAt === 'string' && typeof parsed?.id === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export class SessionsRepository {
  constructor(private readonly db: Database.Database) {}

  create(session: Session): Session {
    this.db
      .prepare(
        `INSERT INTO sessions (
          id, workspace_id, account_name, title, agy_conversation_id,
          status, model, effort, mode, source,
          last_run_id, last_seq, created_at, updated_at, pinned_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.workspaceId,
        session.accountName,
        session.title,
        session.agyConversationId,
        session.status,
        session.model,
        session.effort,
        session.mode,
        session.source,
        session.lastRunId,
        session.lastSeq,
        session.createdAt,
        session.updatedAt,
        session.pinnedAt ?? null,
      );
    return session;
  }

  findById(id: string): Session | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as SessionRow | undefined;
    return row ? toDomain(row) : null;
  }

  findByAgyConversationId(agyConversationId: string): Session | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE agy_conversation_id = ?')
      .get(agyConversationId) as SessionRow | undefined;
    return row ? toDomain(row) : null;
  }

  list(filter: ListSessionsFilter = {}): Page<Session> {
    const limit = Math.max(1, Math.min(filter.limit ?? 50, 100));
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.workspaceId) {
      conditions.push('workspace_id = ?');
      params.push(filter.workspaceId);
    }

    // Count total with workspace filter
    const countSql = `SELECT COUNT(*) AS count FROM sessions ${
      conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    }`;
    const totalRow = this.db.prepare(countSql).get(...params) as { count: number };
    const total = totalRow.count;

    if (filter.cursor) {
      const decoded = decodeCursor(filter.cursor);
      if (decoded) {
        conditions.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
        params.push(decoded.updatedAt, decoded.updatedAt, decoded.id);
      }
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT * FROM sessions
      ${whereClause}
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `;

    const rows = this.db.prepare(sql).all(...params, limit + 1) as SessionRow[];
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(toDomain);

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = encodeCursor(lastItem.updatedAt, lastItem.id);
    }

    return {
      items,
      total,
      hasMore,
      nextCursor,
    };
  }

  listByWorkspaceId(workspaceId: string): Session[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions WHERE workspace_id = ? ORDER BY updated_at DESC, id DESC')
      .all(workspaceId) as SessionRow[];
    return rows.map(toDomain);
  }

  listAll(): Session[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY updated_at DESC, id DESC')
      .all() as SessionRow[];
    return rows.map(toDomain);
  }

  update(id: string, patch: Partial<Omit<Session, 'id' | 'createdAt'>>): Session | null {
    const current = this.findById(id);
    if (!current) return null;

    const updated: Session = {
      ...current,
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    };

    this.db
      .prepare(
        `UPDATE sessions
         SET workspace_id = ?, account_name = ?, title = ?, agy_conversation_id = ?,
             status = ?, model = ?, effort = ?, mode = ?, source = ?,
             last_run_id = ?, last_seq = ?, updated_at = ?, pinned_at = ?
         WHERE id = ?`,
      )
      .run(
        updated.workspaceId,
        updated.accountName,
        updated.title,
        updated.agyConversationId,
        updated.status,
        updated.model,
        updated.effort,
        updated.mode,
        updated.source,
        updated.lastRunId,
        updated.lastSeq,
        updated.updatedAt,
        updated.pinnedAt ?? null,
        id,
      );

    return updated;
  }

  updateLastSeq(id: string, lastSeq: number, updatedAt?: string): void {
    const ts = updatedAt ?? new Date().toISOString();
    this.db
      .prepare('UPDATE sessions SET last_seq = ?, updated_at = ? WHERE id = ?')
      .run(lastSeq, ts, id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
