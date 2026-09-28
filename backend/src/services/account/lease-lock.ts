import { ReadWriteLock, type Lease } from '../../utils/rw-lock.js';
import { AppError } from '../../utils/errors.js';

export interface AccountLeaseLockOptions {
  lock?: ReadWriteLock;
}

/**
 * Global lease lock for credential_snapshot mode.
 * - Multiple read locks (runs, quota probes) can be held concurrently.
 * - Write locks (account switch, login, delete) are exclusive.
 * - In credential_snapshot mode, acquiring a read lock when a write lock is active
 *   or waiting immediately fails with ACCOUNT_SWITCH_IN_PROGRESS.
 * - Acquiring a write lock when readers are active immediately fails with ACCOUNT_BUSY.
 */
export class AccountLeaseLock {
  private readonly lock: ReadWriteLock;

  constructor(options?: AccountLeaseLockOptions) {
    this.lock = options?.lock ?? new ReadWriteLock();
  }

  get readers(): number {
    return this.lock.readers;
  }

  get isWriting(): boolean {
    return this.lock.isWriting;
  }

  get waitingWriters(): number {
    return this.lock.waitingWriters;
  }

  /**
   * Registers a waiting writer to prevent new read leases from being acquired.
   * Returns an unregister function.
   */
  registerWaitingWriter(): () => void {
    return this.lock.registerWaitingWriter();
  }

  tryRead(): Lease | null {
    return this.lock.tryRead();
  }

  acquireRead(): Lease {
    const lease = this.lock.tryRead();
    if (!lease) {
      throw new AppError('ACCOUNT_SWITCH_IN_PROGRESS', 'Account switch or modification is in progress');
    }
    return lease;
  }

  acquireReadLease(): Lease {
    return this.acquireRead();
  }

  tryWrite(): Lease | null {
    return this.lock.tryWrite();
  }

  acquireWrite(): Lease {
    if (this.lock.readers > 0) {
      throw new AppError('ACCOUNT_BUSY', 'Cannot modify accounts while runs or probes are active');
    }
    if (this.lock.isWriting) {
      throw new AppError('ACCOUNT_SWITCH_IN_PROGRESS', 'Another account switch or modification is in progress');
    }
    const lease = this.lock.tryWrite();
    if (!lease) {
      if (this.lock.readers > 0) {
        throw new AppError('ACCOUNT_BUSY', 'Cannot modify accounts while runs or probes are active');
      }
      throw new AppError('ACCOUNT_SWITCH_IN_PROGRESS', 'Account switch or modification is in progress');
    }
    return lease;
  }

  acquireWriteLease(): Lease {
    return this.acquireWrite();
  }

  async withRead<T>(fn: () => Promise<T>): Promise<T> {
    const lease = this.acquireRead();
    try {
      return await fn();
    } finally {
      lease.release();
    }
  }

  async withWrite<T>(fn: () => Promise<T>): Promise<T> {
    const lease = this.acquireWrite();
    try {
      return await fn();
    } finally {
      lease.release();
    }
  }
}
