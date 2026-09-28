import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db: Database.Database) => {
      db.exec(`
        -- Workspaces
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          is_git_repo INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          last_opened_at TEXT NOT NULL
        );

        -- Sessions
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          account_name TEXT,
          title TEXT NOT NULL,
          agy_conversation_id TEXT,
          status TEXT NOT NULL,
          model TEXT,
          effort TEXT,
          mode TEXT,
          source TEXT NOT NULL,
          last_run_id TEXT,
          last_seq INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_workspace_id ON sessions(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_agy_conversation_id ON sessions(agy_conversation_id);

        -- Runs
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          model TEXT,
          account_name TEXT,
          checkpoint_id TEXT,
          pid INTEGER,
          usage_json TEXT,
          error_json TEXT,
          started_at TEXT NOT NULL,
          ended_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_runs_session_id ON runs(session_id);
        CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
        CREATE INDEX IF NOT EXISTS idx_runs_account_name ON runs(account_name);

        -- Events
        CREATE TABLE IF NOT EXISTS events (
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          run_id TEXT,
          ts TEXT NOT NULL,
          type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (session_id, seq)
        );

        -- Attachments
        CREATE TABLE IF NOT EXISTS attachments (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          kind TEXT NOT NULL,
          original_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size INTEGER NOT NULL,
          stored_path TEXT NOT NULL,
          derived_text_path TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_attachments_workspace_id ON attachments(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_attachments_session_id ON attachments(session_id);

        -- Checkpoints
        CREATE TABLE IF NOT EXISTS checkpoints (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          commit_sha TEXT NOT NULL,
          files_changed INTEGER,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_checkpoints_workspace_id ON checkpoints(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_checkpoints_session_id ON checkpoints(session_id);

        -- Accounts (never stores credentials)
        CREATE TABLE IF NOT EXISTS accounts (
          name TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          isolation TEXT NOT NULL,
          email TEXT,
          note TEXT,
          saved_at TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 0
        );

        -- Quota Cache
        CREATE TABLE IF NOT EXISTS quota_cache (
          account_name TEXT NOT NULL,
          source TEXT NOT NULL,
          snapshot_json TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          PRIMARY KEY (account_name, source)
        );

        -- Prefs
        CREATE TABLE IF NOT EXISTS prefs (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL
        );
      `);
    },
  },
];

export function runMigrations(db: Database.Database): void {
  // Ensure schema_migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
    .all() as { version: number }[];
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  const sortedMigrations = [...migrations].sort((a, b) => a.version - b.version);

  for (const migration of sortedMigrations) {
    if (!appliedSet.has(migration.version)) {
      const applyTx = db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
          migration.version,
          new Date().toISOString(),
        );
      });
      applyTx();
    }
  }
}

export function getCurrentVersion(db: Database.Database): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as { version: number } | undefined;
  return row?.version ?? 0;
}
