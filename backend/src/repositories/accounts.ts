import type Database from 'better-sqlite3';
import type { Account, AccountIsolation, AccountType } from '@agy-studio/contracts';

interface AccountRow {
  name: string;
  type: AccountType;
  isolation: AccountIsolation;
  email: string | null;
  note: string | null;
  saved_at: string;
  is_default: number;
}

export type StoredAccount = Omit<Account, 'activeRuns'>;

function toDomain(row: AccountRow): StoredAccount {
  return {
    name: row.name,
    type: row.type,
    isolation: row.isolation,
    email: row.email,
    note: row.note,
    savedAt: row.saved_at,
    active: row.is_default === 1,
  };
}

export class AccountsRepository {
  constructor(private readonly db: Database.Database) {}

  save(account: StoredAccount): StoredAccount {
    const tx = this.db.transaction(() => {
      if (account.active) {
        // Clear active on other accounts
        this.db.prepare('UPDATE accounts SET is_default = 0').run();
      }

      this.db
        .prepare(
          `INSERT INTO accounts (name, type, isolation, email, note, saved_at, is_default)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET
             type = excluded.type,
             isolation = excluded.isolation,
             email = excluded.email,
             note = excluded.note,
             saved_at = excluded.saved_at,
             is_default = excluded.is_default`,
        )
        .run(
          account.name,
          account.type,
          account.isolation,
          account.email ?? null,
          account.note ?? null,
          account.savedAt,
          account.active ? 1 : 0,
        );
    });

    tx();
    return account;
  }

  findByName(name: string): StoredAccount | null {
    const row = this.db
      .prepare('SELECT * FROM accounts WHERE name = ?')
      .get(name) as AccountRow | undefined;
    return row ? toDomain(row) : null;
  }

  findDefault(): StoredAccount | null {
    const row = this.db
      .prepare('SELECT * FROM accounts WHERE is_default = 1')
      .get() as AccountRow | undefined;
    return row ? toDomain(row) : null;
  }

  list(): StoredAccount[] {
    const rows = this.db
      .prepare('SELECT * FROM accounts ORDER BY is_default DESC, saved_at ASC')
      .all() as AccountRow[];
    return rows.map(toDomain);
  }

  setDefault(name: string): boolean {
    const tx = this.db.transaction(() => {
      const exists = this.findByName(name);
      if (!exists) return false;

      this.db.prepare('UPDATE accounts SET is_default = 0').run();
      this.db.prepare('UPDATE accounts SET is_default = 1 WHERE name = ?').run(name);
      return true;
    });

    return tx();
  }

  delete(name: string): boolean {
    const result = this.db.prepare('DELETE FROM accounts WHERE name = ?').run(name);
    return result.changes > 0;
  }
}
