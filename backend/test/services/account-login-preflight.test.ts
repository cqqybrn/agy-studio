import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createDatabase, AccountsRepository } from '../../src/repositories/index.js';
import { CredentialStore } from '../../src/integrations/agy/credential-store.js';
import { MemoryWinCred } from '../../src/integrations/agy/wincred.js';
import { MemoryDpapi } from '../../src/integrations/agy/dpapi.js';
import { AccountService } from '../../src/services/account/account.js';
import { AccountLeaseLock } from '../../src/services/account/lease-lock.js';
import { AppError } from '../../src/utils/errors.js';
import type { LoginPort } from '../../src/services/ports/login.port.js';

describe('AccountService login preflight', () => {
  let db: Database.Database;
  let tempDir: string;
  let keyring: MemoryWinCred;
  let store: CredentialStore;
  let lock: AccountLeaseLock;
  let loginPort: LoginPort & { startLogin: ReturnType<typeof vi.fn> };

  const build = (loginPreflight?: () => Promise<void>) =>
    new AccountService({
      accountsRepo: new AccountsRepository(db),
      credentialStore: store,
      leaseLock: lock,
      loginPort,
      loginPreflight,
      loginPollIntervalMs: 20,
      loginSettleDelayMs: 30,
      loginTimeoutMs: 200,
    });

  beforeEach(async () => {
    db = createDatabase(':memory:');
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-preflight-test-'));
    keyring = new MemoryWinCred();
    lock = new AccountLeaseLock();
    store = new CredentialStore({
      dataDir: tempDir,
      wincred: keyring,
      dpapi: new MemoryDpapi(),
      profile: { credentials: { wincredTargetPatterns: ['gemini:antigravity'], credentialFiles: [] } },
    });
    loginPort = { startLogin: vi.fn() } as never;
  });

  afterEach(async () => {
    db.close();
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('aborts before touching live credentials, the lease or the login terminal', async () => {
    keyring.set('gemini:antigravity', Buffer.from('{"live":"credential"}'));
    const service = build(async () => {
      throw new AppError('AGY_TIMEOUT', 'Google unreachable', { retryable: true });
    });

    const err = await service.startLogin({ saveAs: 'acc' }).catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('AGY_TIMEOUT');
    expect(err.message).toBe('Google unreachable');
    expect(await store.isPresent()).toBe(true);
    expect(keyring.get('gemini:antigravity')?.toString()).toBe('{"live":"credential"}');
    expect(loginPort.startLogin).not.toHaveBeenCalled();
    expect(() => lock.acquireWriteLease().release()).not.toThrow();
    await service.close();
  });

  it('wraps unexpected preflight errors as AppError', async () => {
    const service = build(async () => {
      throw new Error('boom');
    });
    const err = await service.startLogin({ saveAs: 'acc' }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.message).toBe('boom');
    await service.close();
  });

  it('proceeds to the login terminal when the preflight passes', async () => {
    const preflight = vi.fn(async () => {});
    loginPort.startLogin.mockRejectedValue(new Error('stop here'));
    const service = build(preflight);

    await service.startLogin({ saveAs: 'acc' }).catch(() => {});

    expect(preflight).toHaveBeenCalledTimes(1);
    expect(loginPort.startLogin).toHaveBeenCalledTimes(1);
    await service.close();
  });
});
