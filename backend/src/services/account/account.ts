import type {
  Account,
  AccountLoginSession,
  AccountType,
  ISODateString,
  SaveAccountBody,
  WhoAmI,
} from '@agy-studio/contracts';
import type { AccountsRepository, StoredAccount } from '../../repositories/accounts.js';
import type { CredentialPort } from '../ports/credential.port.js';
import type { CredentialSnapshot } from '../ports/credential.port.js';
import type { LoginPort, LoginHandle } from '../ports/login.port.js';
import { AccountLeaseLock } from './lease-lock.js';
import type { Lease } from '../../utils/rw-lock.js';
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
  credentialStore: CredentialPort;
  loginPort?: LoginPort;
  leaseLock?: AccountLeaseLock;
  eventBus?: EventBus;
  runSupervisor?: RunSupervisorLike;
  logger?: Logger;
  loginPollIntervalMs?: number;
  loginSettleDelayMs?: number;
  loginTimeoutMs?: number;
}

interface ActiveLoginCoordinator {
  session: AccountLoginSession;
  saveAs: string;
  handle: LoginHandle;
  liveBackup: CredentialSnapshot | null;
  writeLease: Lease;
  abortController: AbortController;
  completionPromise: Promise<AccountLoginSession>;
  resolveCompletion: (sess: AccountLoginSession) => void;
  abort: (reason: 'cancelled' | 'failed' | 'timeout') => Promise<void>;
}

function interruptibleSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function snapshotsMatch(s1: CredentialSnapshot, s2: CredentialSnapshot): boolean {
  const t1 = Object.keys(s1.targets).sort();
  const t2 = Object.keys(s2.targets).sort();
  const f1 = Object.keys(s1.files).sort();
  const f2 = Object.keys(s2.files).sort();

  if (t1.length === 0 && f1.length === 0) {
    return false;
  }
  if (t1.length !== t2.length || f1.length !== f2.length) {
    return false;
  }
  for (let i = 0; i < t1.length; i++) {
    const k = t1[i];
    if (k !== t2[i] || s1.targets[k] !== s2.targets[k]) return false;
  }
  for (let i = 0; i < f1.length; i++) {
    const k = f1[i];
    if (k !== f2[i] || s1.files[k] !== s2.files[k]) return false;
  }
  return true;
}

export class AccountService {
  private readonly accountsRepo: AccountsRepository;
  private readonly credentialStore: CredentialPort;
  private readonly loginPort?: LoginPort;
  private readonly leaseLock: AccountLeaseLock;
  private readonly eventBus?: EventBus;
  private readonly runSupervisor?: RunSupervisorLike;
  private readonly logger: Logger;
  private readonly loginPollIntervalMs: number;
  private readonly loginSettleDelayMs: number;
  private readonly loginTimeoutMs: number;

  private activeLogin: ActiveLoginCoordinator | null = null;
  private readonly loginSessions = new Map<string, AccountLoginSession>();

  constructor(options: AccountServiceOptions) {
    this.accountsRepo = options.accountsRepo;
    this.credentialStore = options.credentialStore;
    this.loginPort = options.loginPort;
    this.leaseLock = options.leaseLock ?? new AccountLeaseLock();
    this.eventBus = options.eventBus;
    this.runSupervisor = options.runSupervisor;
    this.logger = options.logger ?? defaultLogger;
    this.loginPollIntervalMs = options.loginPollIntervalMs ?? 2000;
    this.loginSettleDelayMs = options.loginSettleDelayMs ?? 2000;
    this.loginTimeoutMs = options.loginTimeoutMs ?? 10 * 60 * 1000;
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
   */
  async switchAccount(name: string): Promise<{ whoami: WhoAmI }> {
    const writeLease = this.leaseLock.acquireWriteLease();
    let liveBackup: CredentialSnapshot | null = null;
    let liveTouched = false;

    try {
      const targetAcc = this.accountsRepo.findByName(name);
      if (!targetAcc) {
        throw new AppError('ACCOUNT_NOT_FOUND', `Account "${name}" not found`);
      }

      if (!this.credentialStore.hasSnapshot(name)) {
        throw new AppError('NOT_FOUND', `Credential snapshot for account "${name}" not found`);
      }

      // 1. 从磁盘读取并解密目标账号的快照，校验载荷非空（未通过则不碰 live 凭据）
      const targetSnapshot = await this.credentialStore.loadSnapshot(name);
      this.credentialStore.assertRestorable(targetSnapshot);

      // 2. 备份当前 live 凭据（若有）到临时快照
      if (await this.credentialStore.isPresent()) {
        liveBackup = await this.credentialStore.takeLiveSnapshot();
      }

      // 3. restore 目标凭据
      liveTouched = true;
      await this.credentialStore.restore(targetSnapshot);

      // 4. 校验凭据已生效（isPresent()，且 id_token.sub 符合）
      const isPresent = await this.credentialStore.isPresent();
      if (!isPresent) {
        throw new AppError('INTERNAL', 'Failed to verify restored credentials: not present');
      }

      const liveClaims = await this.credentialStore.readLiveClaims();
      const targetClaims = this.credentialStore.claimsOf(targetSnapshot);

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
      if (liveBackup && liveTouched) {
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

  /**
   * Starts a new account login orchestration.
   * State machine: pending -> awaiting_browser -> completed / failed / cancelled.
   */
  async startLogin(input: { saveAs: string }): Promise<AccountLoginSession> {
    const saveAs = input?.saveAs?.trim();
    if (!saveAs) {
      throw new AppError('BAD_REQUEST', 'saveAs is required');
    }

    if (
      this.activeLogin &&
      (this.activeLogin.session.status === 'pending' ||
        this.activeLogin.session.status === 'awaiting_browser')
    ) {
      throw new AppError(
        'ACCOUNT_SWITCH_IN_PROGRESS',
        'A login flow is already in progress',
      );
    }

    // Acquire write lease (throws ACCOUNT_SWITCH_IN_PROGRESS / ACCOUNT_BUSY if busy)
    const writeLease = this.leaseLock.acquireWriteLease();

    let liveBackup: CredentialSnapshot | null = null;
    let handle: LoginHandle;
    let initialSession: AccountLoginSession;

    try {
      if (await this.credentialStore.isPresent()) {
        liveBackup = await this.credentialStore.takeLiveSnapshot();
      }
      await this.credentialStore.clear();

      if (!this.loginPort) {
        throw new AppError('INTERNAL', 'LoginPort is not configured');
      }

      handle = await this.loginPort.startLogin({
        accountName: saveAs,
      });

      initialSession = {
        loginId: handle.loginId,
        status: 'awaiting_browser',
        authUrl: null,
        email: null,
        error: null,
      };
      this.loginSessions.set(initialSession.loginId, { ...initialSession });
    } catch (err) {
      if (liveBackup) {
        try {
          await this.credentialStore.restore(liveBackup);
        } catch {}
      }
      writeLease.release();
      throw AppError.from(err);
    }

    const abortController = new AbortController();
    let resolveCompletion!: (sess: AccountLoginSession) => void;
    const completionPromise = new Promise<AccountLoginSession>((resolve) => {
      resolveCompletion = resolve;
    });

    const coordinator: ActiveLoginCoordinator = {
      session: initialSession,
      saveAs,
      handle,
      liveBackup,
      writeLease,
      abortController,
      completionPromise,
      resolveCompletion,
      abort: async (reason: 'cancelled' | 'failed' | 'timeout') => {
        if (
          initialSession.status === 'awaiting_browser' ||
          initialSession.status === 'pending'
        ) {
          initialSession.status = reason === 'timeout' ? 'cancelled' : reason;
          if (reason === 'timeout') {
            initialSession.error = 'Login timed out';
          }
        }
        abortController.abort();
        await completionPromise;
      },
    };

    this.activeLogin = coordinator;

    void this.runLoginOrchestration(coordinator);

    return { ...initialSession };
  }

  private async runLoginOrchestration(coord: ActiveLoginCoordinator): Promise<void> {
    const {
      session,
      saveAs,
      handle,
      liveBackup,
      writeLease,
      abortController,
      resolveCompletion,
    } = coord;
    const signal = abortController.signal;

    const pollIntervalMs = this.loginPollIntervalMs;
    const settleDelayMs = this.loginSettleDelayMs;
    const timeoutMs = this.loginTimeoutMs;
    const deadline = Date.now() + timeoutMs;

    let timeoutTimer: NodeJS.Timeout | null = null;
    timeoutTimer = setTimeout(() => {
      if (
        !signal.aborted &&
        (session.status === 'awaiting_browser' || session.status === 'pending')
      ) {
        session.status = 'cancelled';
        session.error = 'Login timed out';
        abortController.abort();
      }
    }, timeoutMs);

    try {
      while (!signal.aborted && Date.now() < deadline) {
        let isPresent = false;
        try {
          isPresent = await this.credentialStore.isPresent();
        } catch (err) {
          this.logger.warn({ err }, 'Error checking credentialStore.isPresent()');
        }

        if (isPresent) {
          // Credentials appeared! Wait settleDelayMs
          await interruptibleSleep(settleDelayMs, signal);
          if (signal.aborted) break;

          // Take snapshot 1
          const snap1 = await this.credentialStore.takeLiveSnapshot();

          // Wait short settle interval
          await interruptibleSleep(Math.min(500, settleDelayMs), signal);
          if (signal.aborted) break;

          // Take snapshot 2
          const snap2 = await this.credentialStore.takeLiveSnapshot();

          if (snapshotsMatch(snap1, snap2)) {
            // Credentials verified stable! Snapshot as saveAs
            await this.credentialStore.snapshot(saveAs);

            const claims = await this.credentialStore.readLiveClaims();
            const email = claims?.email ?? null;

            const existing = this.accountsRepo.findByName(saveAs);
            const stored: StoredAccount = {
              name: saveAs,
              type: 'oauth',
              isolation: 'credential_snapshot',
              email: email ?? existing?.email ?? null,
              note: existing?.note ?? null,
              savedAt: new Date().toISOString(),
              active: true,
            };
            this.accountsRepo.save(stored);
            this.accountsRepo.setDefault(saveAs);

            session.status = 'completed';
            session.email = stored.email;
            session.error = null;

            if (this.eventBus) {
              this.eventBus.publishGlobal({
                type: 'account.changed',
                whoami: {
                  activeProfile: saveAs,
                  email: stored.email,
                  accountType: 'oauth',
                  isolation: 'credential_snapshot',
                  credentialPresent: true,
                },
              });
            }

            this.logger.info(
              { accountName: saveAs, email: stored.email },
              'Login flow completed successfully',
            );
            break;
          }
        }

        await interruptibleSleep(pollIntervalMs, signal);
      }

      if (!signal.aborted && Date.now() >= deadline && session.status === 'awaiting_browser') {
        session.status = 'cancelled';
        session.error = 'Login timed out';
      }
    } catch (err) {
      this.logger.error({ err }, 'Unexpected error in login loop');
      session.status = 'failed';
      session.error = (err as Error).message ?? String(err);
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }

      try {
        if (session.status !== 'completed') {
          // Restore original live credentials
          if (liveBackup) {
            try {
              await this.credentialStore.restore(liveBackup);
              this.logger.info('Restored original live credentials after uncompleted login');
            } catch (restoreErr) {
              this.logger.error(
                { restoreErr },
                'Failed to restore original credentials after uncompleted login',
              );
            }
          } else {
            try {
              await this.credentialStore.clear();
            } catch {}
          }
        }
      } finally {
        try {
          await handle.cancel();
        } catch (cancelErr) {
          this.logger.warn({ cancelErr }, 'Failed to cancel login terminal handle');
        }

        if (this.activeLogin?.session.loginId === session.loginId) {
          this.activeLogin = null;
        }

        writeLease.release();
        this.loginSessions.set(session.loginId, { ...session });
        resolveCompletion({ ...session });
      }
    }
  }

  /**
   * Returns current login session state.
   */
  getLoginSession(loginId: string): AccountLoginSession {
    const session = this.loginSessions.get(loginId);
    if (!session) {
      throw new AppError('NOT_FOUND', `Login session "${loginId}" not found`);
    }
    return { ...session };
  }

  /**
   * Cancels an ongoing login process.
   */
  async cancelLogin(loginId: string): Promise<AccountLoginSession> {
    const session = this.loginSessions.get(loginId);
    if (!session) {
      throw new AppError('NOT_FOUND', `Login session "${loginId}" not found`);
    }

    if (this.activeLogin && this.activeLogin.session.loginId === loginId) {
      await this.activeLogin.abort('cancelled');
      return this.loginSessions.get(loginId)!;
    }

    return { ...session };
  }

  /**
   * Waits for login completion (useful in tests and internal orchestration).
   */
  async waitForLoginCompletion(loginId: string): Promise<AccountLoginSession> {
    const session = this.loginSessions.get(loginId);
    if (!session) {
      throw new AppError('NOT_FOUND', `Login session "${loginId}" not found`);
    }
    if (this.activeLogin && this.activeLogin.session.loginId === loginId) {
      return this.activeLogin.completionPromise;
    }
    return { ...session };
  }

  /**
   * Cancels active login if one is in progress (e.g. during graceful shutdown).
   */
  async cancelActiveLogin(): Promise<void> {
    if (this.activeLogin) {
      await this.activeLogin.abort('cancelled');
    }
  }

  /**
   * Graceful cleanup of account service.
   */
  async close(): Promise<void> {
    await this.cancelActiveLogin();
  }
}
