import type Database from 'better-sqlite3';
import type { Attachment, AttachmentKind } from '@agy-studio/contracts';

interface AttachmentRow {
  id: string;
  workspace_id: string;
  session_id: string | null;
  kind: AttachmentKind;
  original_name: string;
  mime_type: string;
  size: number;
  stored_path: string;
  derived_text_path: string | null;
  created_at: string;
}

function toDomain(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    kind: row.kind,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    storedPath: row.stored_path,
    derivedTextPath: row.derived_text_path,
    createdAt: row.created_at,
  };
}

export class AttachmentsRepository {
  constructor(private readonly db: Database.Database) {}

  create(attachment: Attachment): Attachment {
    this.db
      .prepare(
        `INSERT INTO attachments (
          id, workspace_id, session_id, kind, original_name,
          mime_type, size, stored_path, derived_text_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attachment.id,
        attachment.workspaceId,
        attachment.sessionId ?? null,
        attachment.kind,
        attachment.originalName,
        attachment.mimeType,
        attachment.size,
        attachment.storedPath,
        attachment.derivedTextPath ?? null,
        attachment.createdAt,
      );
    return attachment;
  }

  findById(id: string): Attachment | null {
    const row = this.db
      .prepare('SELECT * FROM attachments WHERE id = ?')
      .get(id) as AttachmentRow | undefined;
    return row ? toDomain(row) : null;
  }

  findByIds(ids: string[]): Attachment[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM attachments WHERE id IN (${placeholders})`)
      .all(...ids) as AttachmentRow[];
    return rows.map(toDomain);
  }

  listByWorkspaceId(workspaceId: string): Attachment[] {
    const rows = this.db
      .prepare('SELECT * FROM attachments WHERE workspace_id = ? ORDER BY created_at DESC')
      .all(workspaceId) as AttachmentRow[];
    return rows.map(toDomain);
  }

  listBySessionId(sessionId: string): Attachment[] {
    const rows = this.db
      .prepare('SELECT * FROM attachments WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as AttachmentRow[];
    return rows.map(toDomain);
  }

  update(
    id: string,
    patch: Partial<Pick<Attachment, 'sessionId' | 'derivedTextPath'>>,
  ): Attachment | null {
    const current = this.findById(id);
    if (!current) return null;

    const updated: Attachment = {
      ...current,
      ...patch,
    };

    this.db
      .prepare(
        `UPDATE attachments
         SET session_id = ?, derived_text_path = ?
         WHERE id = ?`,
      )
      .run(updated.sessionId ?? null, updated.derivedTextPath ?? null, id);

    return updated;
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
