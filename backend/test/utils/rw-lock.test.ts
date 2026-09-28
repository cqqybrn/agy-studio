import { describe, expect, it } from 'vitest';
import { ReadWriteLock } from '../../src/utils/rw-lock.js';

describe('utils/rw-lock', () => {
  it('allows multiple concurrent readers', () => {
    const lock = new ReadWriteLock();
    const r1 = lock.tryRead();
    const r2 = lock.tryRead();

    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(lock.readers).toBe(2);

    // Try write fails when readers exist
    expect(lock.tryWrite()).toBeNull();

    r1?.release();
    expect(lock.readers).toBe(1);
    expect(lock.tryWrite()).toBeNull();

    r2?.release();
    expect(lock.readers).toBe(0);

    // Now write lock succeeds
    const w = lock.tryWrite();
    expect(w).not.toBeNull();
    w?.release();
  });

  it('blocks readers and other writers when a write lock is held', () => {
    const lock = new ReadWriteLock();
    const w = lock.tryWrite();
    expect(w).not.toBeNull();
    expect(lock.isWriting).toBe(true);

    expect(lock.tryRead()).toBeNull();
    expect(lock.tryWrite()).toBeNull();

    w?.release();
    expect(lock.isWriting).toBe(false);

    const r = lock.tryRead();
    expect(r).not.toBeNull();
    r?.release();
  });

  it('blocks new readers when a writer is waiting', () => {
    const lock = new ReadWriteLock();
    const r1 = lock.tryRead();
    expect(r1).not.toBeNull();

    // A writer indicates it is waiting
    const unregisterWriter = lock.registerWaitingWriter();
    expect(lock.waitingWriters).toBe(1);

    // New read attempt fails immediately because a writer is waiting
    expect(lock.tryRead()).toBeNull();

    // Cancel waiting writer
    unregisterWriter();
    expect(lock.waitingWriters).toBe(0);

    // Now new reader can acquire
    const r2 = lock.tryRead();
    expect(r2).not.toBeNull();

    r1?.release();
    r2?.release();
    expect(lock.readers).toBe(0);
  });

  it('ensures release() is idempotent for both read and write leases', () => {
    const lock = new ReadWriteLock();

    const r = lock.tryRead();
    expect(lock.readers).toBe(1);
    r?.release();
    expect(lock.readers).toBe(0);
    r?.release(); // Should not decrement again below 0
    expect(lock.readers).toBe(0);

    const w = lock.tryWrite();
    expect(lock.isWriting).toBe(true);
    w?.release();
    expect(lock.isWriting).toBe(false);
    w?.release();
    expect(lock.isWriting).toBe(false);
  });

  it('handles concurrent lock acquisition attempts simulation', async () => {
    const lock = new ReadWriteLock();
    const results: string[] = [];

    // Simulate 50 parallel reader attempts
    const readerPromises = Array.from({ length: 50 }).map(async (_, idx) => {
      const lease = lock.tryRead();
      if (lease) {
        results.push(`read_${idx}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        lease.release();
      }
    });

    await Promise.all(readerPromises);
    expect(lock.readers).toBe(0);
    expect(results.length).toBe(50);

    // Now test concurrent writer conflict
    const w1 = lock.tryWrite();
    const w2 = lock.tryWrite();
    expect(w1).not.toBeNull();
    expect(w2).toBeNull();
    w1?.release();
    expect(lock.isWriting).toBe(false);
  });
});
