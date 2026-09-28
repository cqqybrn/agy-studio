export interface Lease {
  readonly kind: 'read' | 'write';
  release(): void;
}

export class ReadWriteLock {
  private _readers = 0;
  private _hasWriter = false;
  private _waitingWriters = 0;

  get readers(): number {
    return this._readers;
  }

  get isWriting(): boolean {
    return this._hasWriter;
  }

  get waitingWriters(): number {
    return this._waitingWriters;
  }

  /**
   * Acquire a read lease immediately.
   * Returns null if a write lock is held or a writer is waiting.
   */
  tryRead(): Lease | null {
    if (this._hasWriter || this._waitingWriters > 0) {
      return null;
    }

    this._readers += 1;
    let released = false;

    return {
      kind: 'read',
      release: () => {
        if (released) return;
        released = true;
        this._readers -= 1;
      },
    };
  }

  /**
   * Acquire a write lease immediately.
   * Returns null if any read lock is held or another write lock is held.
   */
  tryWrite(): Lease | null {
    if (this._hasWriter || this._readers > 0) {
      return null;
    }

    this._hasWriter = true;
    let released = false;

    return {
      kind: 'write',
      release: () => {
        if (released) return;
        released = true;
        this._hasWriter = false;
      },
    };
  }

  /**
   * Register that a write lock is waiting to be acquired.
   * While waiting writers > 0, new tryRead() attempts return null.
   * Returns a cancel function.
   */
  registerWaitingWriter(): () => void {
    this._waitingWriters += 1;
    let unregistered = false;

    return () => {
      if (unregistered) return;
      unregistered = true;
      this._waitingWriters -= 1;
    };
  }
}
