import type Database from 'better-sqlite3';
import type { AgentEvent, SessionEventEnvelope } from '@agy-studio/contracts';

interface EventRow {
  session_id: string;
  seq: number;
  run_id: string | null;
  ts: string;
  type: string;
  payload_json: string;
}

function toDomain(row: EventRow): SessionEventEnvelope {
  return {
    seq: row.seq,
    sessionId: row.session_id,
    runId: row.run_id,
    ts: row.ts,
    event: JSON.parse(row.payload_json) as AgentEvent,
  };
}

export class EventsRepository {
  constructor(private readonly db: Database.Database) {}

  appendBatch(sessionId: string, envelopes: SessionEventEnvelope[]): void {
    if (!envelopes || envelopes.length === 0) {
      return;
    }

    const insertStmt = this.db.prepare(
      `INSERT INTO events (session_id, seq, run_id, ts, type, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    const updateSessionStmt = this.db.prepare(
      `UPDATE sessions
       SET last_seq = MAX(last_seq, ?), updated_at = ?
       WHERE id = ?`,
    );

    const tx = this.db.transaction(() => {
      let maxSeq = 0;
      let latestTs = '';

      for (const envelope of envelopes) {
        insertStmt.run(
          sessionId,
          envelope.seq,
          envelope.runId ?? null,
          envelope.ts,
          envelope.event.type,
          JSON.stringify(envelope.event),
        );

        if (envelope.seq > maxSeq) {
          maxSeq = envelope.seq;
        }
        if (!latestTs || envelope.ts > latestTs) {
          latestTs = envelope.ts;
        }
      }

      updateSessionStmt.run(maxSeq, latestTs || new Date().toISOString(), sessionId);
    });

    tx();
  }

  listAfter(sessionId: string, afterSeq: number, limit?: number): SessionEventEnvelope[] {
    const lim = limit !== undefined ? Math.max(1, limit) : undefined;
    const sql = `
      SELECT session_id, seq, run_id, ts, type, payload_json
      FROM events
      WHERE session_id = ? AND seq > ?
      ORDER BY seq ASC
      ${lim !== undefined ? 'LIMIT ?' : ''}
    `;

    const params: unknown[] = [sessionId, afterSeq];
    if (lim !== undefined) {
      params.push(lim);
    }

    const rows = this.db.prepare(sql).all(...params) as EventRow[];
    return rows.map(toDomain);
  }

  latestSeq(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM events WHERE session_id = ?')
      .get(sessionId) as { max_seq: number } | undefined;
    return row?.max_seq ?? 0;
  }

  listBySessionId(sessionId: string): SessionEventEnvelope[] {
    const rows = this.db
      .prepare(
        `SELECT session_id, seq, run_id, ts, type, payload_json
         FROM events
         WHERE session_id = ?
         ORDER BY seq ASC`,
      )
      .all(sessionId) as EventRow[];
    return rows.map(toDomain);
  }

  deleteBySessionId(sessionId: string): number {
    const result = this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId);
    return result.changes;
  }
}
