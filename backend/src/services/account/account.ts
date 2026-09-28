import type {
  Account,
  AccountType,
  ISODateString,
  SaveAccountBody,
  WhoAmI,
} from '@agy-studio/contracts';
import type { AccountsRepository, StoredAccount } from '../../repositories/accounts.js';
import type { CredentialStore } from '../../integrations/agy/credential-store.js';
import { extractClaimsFromSnapshot } from '../../integrations/agy/credential-store.js';
import type { CredentialSnapshot } from '../ports/credential.port.js';
import { AccountLeaseLock } from './lease-lock.js';
import type { EventBus } from '../event-bus.js';
import { AppError } from '../../utils/errors.js';
import type { Logger } from 'pino';
import { logger as defaultLogger } from '../../utils/logger.js';

export interface AccountLease {
  readonly accountName: string | null;
  readonly env?: Record<string, string>;
  release(): void;
}

export interface RunSupervisorLike {
  activeRuns(): Array<{ accountName: string | null }>;
}

export interface AccountServiceOptions {
  accountsRepo: AccountsRepository;
  credentialStore: CredentialStore;
  leaseLock?: AccountLeaseLock;
  eventBus?: EventBus;
  runSupervisor?: RunSupervisorLike;
  logger?: Logger;
}

export class AccountService {
  private readonly accountsRepo: AccountsRepository;
  private readonly credentialStore: CredentialStore;
  private readonly leaseLock: AccountLeaseLock;
  private readonly eventBus?: EventBus;
  private readonly runSupervisor?: RunSupervisorLike;
  private readonly logger: Logger;

  constructor(options: AccountServiceOptions) {
    this.accountsRepo = options.accountsRepo;
    this.credentialStore = options.credentialStore;
    this.leaseLock = options.leaseLock ?? new AccountLeaseLock();
    this.eventBus = options.eventBus;
    this.runSupervisor = options.runSupervisor;
    this.logger = options.logger ?? defaultLogger;
  }

  getLock(): AccountLeaseLock {
    return this.leaseLock;
  }

  /**
   * Returns list of all accounts annotated with live status and active runs count.
   */
  async listAccounts(): Promise<Account[]> {
    const storedAccounts = this.accountsRepo.list();
    const liveClaims = await this.credentialStore.readLiveClaims();

    // Map active runs by account
    const activeRunsMap = new Map<string, number>();
    if (this.runSupervisor) {
      for (const run of this.runSupervisor.activeRuns()) {
        if (run.accountName) {
          activeRunsMap.set(run.accountName, (activeRunsMap.get(run.accountName) ?? 0) + 1);
        }
      }
    }

    return storedAccounts.map((acc) => {
      const email = acc.email ?? (acc.active ? (liveClaims?.email ?? null) : null);
      return {
        name: acc.name,
        type: acc.type,
        isolation: acc.isolation,
        email,
        note: acc.note,
        savedAt: acc.savedAt as ISODateString,
        active: acc.active,
        activeRuns: activeRunsMap.get(acc.name) ?? 0,
      };
    });
  }

  /**
   * Returns current live account identity.
   */
  async whoami(): Promise<WhoAmI> {
    const isPresent = await this.credentialStore.isPresent();
    if (!isPresent) {
      return {
        activeProfile: null,
        email: null,
        accountType: null,
        isolation: 'credential_snapshot',
        credentialPresent: false,
      };
    }

    const liveClaims = await this.credentialStore.readLiveClaims();
    const defaultAccount = this.accountsRepo.findDefault();

    if (defaultAccount) {
      return {
        activeProfile: defaultAccount.name,
        email: liveClaims?.email ?? defaultAccount.email ?? null,
        accountType: defaultAccount.type,
        isolation: 'credential_snapshot',
        credentialPresent: true,
      };
    }

    // If no default marked in repo, check if any stored account matches the live email
    const all = this.accountsRepo.list();
    const matched = liveClaims?.email ? all.find((a) => a.email === liveClaims.email) : null;

    return {
      activeProfile: matched?.name ?? null,
      email: liveClaims?.email ?? matched?.email ?? null,
      accountType: matched?.type ?? 'oauth',
      isolation: 'credential_snapshot',
      credentialPresent: true,
    };
  }

  /**
   * Saves or updates an account record, and captures live credentials snapshot if present.
   */
  async saveAccount(input: SaveAccountBody): Promise<Account> {
    const name = input.name?.trim();
    if (!name) {
      throw new AppError('BAD_REQUEST', 'Account name is required');
    }

    const type: AccountType = input.type ?? 'oauth';
    if (type === 'apikey' && !input.apiKey) {
      throw new AppError('BAD_REQUEST', 'apiKey is required for apikey account');
    }

    const lease = this.leaseLock.acquireReadLease();
    try {
      const existing = this.accountsRepo.findByName(name);
      const liveClaims = await this.credentialStore.readLiveClaims();
      const isPresent = await this.credentialStore.isPresent();

      // Snapshot live credentials to disk for this account if live credentials exist
      if (isPresent) {
        await this.credentialStore.snapshot(name);
      }

      const all = this.accountsRepo.list();
      const isActive = existing ? existing.active : all.length === 0;

      const email = liveClaims?.email ?? existing?.email ?? null;

      const stored: StoredAccount = {
        name,
        type,
        isolation: 'credential_snapshot',
        email,
        note: input.note !== undefined ? input.note : (existing?.note ?? null),
        savedAt: new Date().toISOString(),
        active: isActive,
      };

      this.accountsRepo.save(stored);

      this.logger.info({ accountName: name, type, hasEmail: Boolean(email) }, 'Saved account record');

      return {
        ...stored,
        savedAt: stored.savedAt as ISODateString,
        activeRuns: 0,
      };
    } finally {
      lease.release();
    }
  }

  /**
   * Sets the given account as default.
   */
  async setDefault(name: string): Promise<Account> {
    const existing = this.accountsRepo.findByName(name);
    if (!existing) {
      throw new AppError('ACCOUNT_NOT_FOUND', `Account "${name}" not found`);
    }

    this.accountsRepo.setDefault(name);
    return {
      ...existing,
      savedAt: existing.savedAt as ISODateString,
      active: true,
      activeRuns: 0,
    };
  }

  /**
   * Deletes an account. Holds write lock. If this is the active live account, clears live credentials.
   */
  async deleteAccount(name: string): Promise<void> {
    const lease = this.leaseLock.acquireWriteLease();
    try {
      const existing = this.accountsRepo.findByName(name);
      if (!existing) {
        throw new AppError('ACCOUNT_NOT_FOUND', `Account "${name}" not found`);
      }

      if (existing.active) {
        await this.credentialStore.clear();
      }

      this.accountsRepo.delete(name);
      await this.credentialStore.deleteSnapshot(name);

      this.logger.info({ accountName: name }, 'Deleted account and credentials snapshot');
    } finally {
      lease.release();
    }
  }

  /**
   * Acquires a read lease for runs or quota probes.
   */
  acquireLease(accountName?: string | null): AccountLease {
    const readLease = this.leaseLock.acquireReadLease();
    const targetAccount = accountName ?? this.accountsRepo.findDefault()?.name ?? null;

    return {
      accountName: targetAccount,
      release: () => {
        readLease.release();
      },
    };
  }

  /**
   * Hook called when a run finishes to sync back refreshed live credentials into the account snapshot.
   */
  async onRunCompleted(accountName: string | null): Promise<void> {
    if (!accountName) return;
    try {
      if (await this.credentialStore.isPresent()) {
        const defaultAcc = this.accountsRepo.findDefault();
        if (!defaultAcc || defaultAcc.name === accountName) {
          await this.credentialStore.snapshot(accountName);
          this.logger.debug({ accountName }, 'Synced refreshed live credentials back to account snapshot');
        }
      }
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message, accountName },
        'Failed to sync refreshed live credentials after run completed',
      );
    }
  }

  /**
   * Switches the active account in credential_snapshot mode.
   * Steps:
   * 1. Acquire write lease (immediate failure if readers or writer exist).
   * 2. Backup current live credentials to temporary in-memory snapshot.
   * 3. Read and decrypt target snapshot from disk.
   * 4. Restore target credentials to live slot.
   * 5. Verify restored credentials (isPresent && id_token.sub matches).
   * 6. Discard temporary backup, update active flag in DB, broadcast account.changed.
   * 7. On any failure: rollback immediately using temporary backup and throw error.
   */
  async switchAccount(name: string): Promise<{ whoami: WhoAmI }> {
    const writeLease = this.leaseLock.acquireWriteLease();
    let liveBackup: CredentialSnapshot | null = null;

    try {
      const targetAcc = this.accountsRepo.findByName(name);
      if (!targetAcc) {
        throw new AppError('ACCOUNT_NOT_FOUND', `Account "${name}" not found`);
      }

      if (!this.credentialStore.hasSnapshot(name)) {
        throw new AppError('NOT_FOUND', `Credential snapshot for account "${name}" not found`);
      }

      // 1. 备份当前 live 凭据（若有）到临时快照
      if (await this.credentialStore.isPresent()) {
        liveBackup = await this.credentialStore.takeLiveSnapshot();
      }

      // 2. 从磁盘读取并解密目标账号的快照
      const targetSnapshot = await this.credentialStore.loadSnapshot(name);

      // 3. restore 目标凭据
      await this.credentialStore.restore(targetSnapshot);

      // 4. 校验凭据已生效（isPresent()，且 id_token.sub 符合）
      const isPresent = await this.credentialStore.isPresent();
      if (!isPresent) {
        throw new AppError('INTERNAL', 'Failed to verify restored credentials: not present');
      }

      const liveClaims = await this.credentialStore.readLiveClaims();
      const targetClaims = extractClaimsFromSnapshot(targetSnapshot);

      if (targetClaims?.sub) {
        if (!liveClaims?.sub || targetClaims.sub !== liveClaims.sub) {
          throw new AppError(
            'INTERNAL',
            `Restored credential sub verification failed: expected ${targetClaims.sub}, got ${liveClaims?.sub ?? 'none'}`,
          );
        }
      }

      // 5. 成功后删除临时备份
      liveBackup = null;

      // 6. 更新 accounts 表 active 标记
      this.accountsRepo.setDefault(name);

      // 7. 广播全局事件
      const whoami: WhoAmI = {
        activeProfile: name,
        email: liveClaims?.email ?? targetAcc.email ?? null,
        accountType: targetAcc.type,
        isolation: 'credential_snapshot',
        credentialPresent: true,
      };

      if (this.eventBus) {
        this.eventBus.publishGlobal({
          type: 'account.changed',
          whoami,
        });
      }

      this.logger.info({ accountName: name, email: whoami.email }, 'Successfully switched account');

      return { whoami };
    } catch (err) {
      // 任一步失败，立即使用临时备份 restore 恢复原凭据
      if (liveBackup) {
        try {
          await this.credentialStore.restore(liveBackup);
          this.logger.info('Rolled back to previous live credentials after switch failure');
        } catch (rollbackErr) {
          this.logger.error(
            { rollbackErr: (rollbackErr as Error).message },
            'Failed to restore previous credentials during switch rollback',
          );
        }
      }
      throw AppError.from(err);
    } finally {
      writeLease.release();
    }
  }
}
