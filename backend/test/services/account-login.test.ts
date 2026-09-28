import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  createDatabase,
  AccountsRepository,
  EventsRepository,
} from '../../src/repositories/index.js';
import {
  CredentialStore,
  MemoryKeyringProvider,
} from '../../src/integrations/agy/credential-store.js';
import { MemoryDpapi } from '../../src/integrations/agy/dpapi.js';
import { AccountService } from '../../src/services/account/account.js';
import { AccountLeaseLock } from '../../src/services/account/lease-lock.js';
import { EventBus } from '../../src/services/event-bus.js';
import { AppError } from '../../src/utils/errors.js';
import type { LoginPort, LoginHandle } from '../../src/services/ports/login.port.js';
import type { AccountLoginSession } from '@agy-studio/contracts';

function createFakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.signature`;
}

function makeCredJson(sub: string, email: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      token: {
        access_token: 'acc-token-' + sub,
        refresh_token: 'ref-token-' + sub,
        token_type: 'Bearer',
        expiry: '2026-09-28T22:00:00.0000000Z',
      },
      auth_method: 'consumer',
      id_token: createFakeJwt({ sub, email }),
    }),
  );
}

class MockLoginPort implements LoginPort {
  readonly killMock = vi.fn();
  activeHandle: LoginHandle | null = null;
  failStart = false;

  async startLogin(options: { accountName: string }): Promise<LoginHandle> {
    if (this.failStart) {
      throw new Error('Terminal spawn failed');
    }

    const loginId = `login_${Date.now()}`;
    let session: AccountLoginSession = {
      loginId,
      status: 'awaiting_browser',
      authUrl: null,
      email: null,
      error: null,
    };

    const handle: LoginHandle = {
      loginId,
      get session() {
        return session;
      },
      waitForAuthUrl: async () => '',
      waitForCompletion: async () => session,
      cancel: async () => {
        this.killMock();
        session = { ...session, status: 'cancelled' };
      },
    };

    this.activeHandle = handle;
    return handle;
  }
}

describe('AccountService Login Orchestration', () => {
  let db: Database.Database;
  let tempDir: string;
  let accountsRepo: AccountsRepository;
  let eventsRepo: EventsRepository;
  let eventBus: EventBus;
  let keyring: MemoryKeyringProvider;
  let dpapi: MemoryDpapi;
  let store: CredentialStore;
  let lock: AccountLeaseLock;
  let loginPort: MockLoginPort;
  let service: AccountService;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-login-test-'));
    accountsRepo = new AccountsRepository(db);
    eventsRepo = new EventsRepository(db);
    eventBus = new EventBus({ eventsRepo });
    keyring = new MemoryKeyringProvider();
    dpapi = new MemoryDpapi();
    lock = new AccountLeaseLock();
    loginPort = new MockLoginPort();

    store = new CredentialStore({
      dataDir: tempDir,
      keyringProvider: keyring,
      dpapi,
      profile: {
        credentials: {
          wincredTargetPatterns: ['gemini:antigravity'],
          credentialFiles: [],
        },
      },
    });

    service = new AccountService({
      accountsRepo,
      credentialStore: store,
      leaseLock: lock,
      loginPort,
      eventBus,
      loginPollIntervalMs: 20,
      loginSettleDelayMs: 30,
      loginTimeoutMs: 200,
    });
  });

  afterEach(async () => {
    await service.close();
    db.close();
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('successful login flow saves new account, updates DB, emits event, and releases lock', async () => {
    // 1. Setup existing live credentials
    keyring.set('gemini:antigravity', makeCredJson('user-old', 'old@example.com'));
    expect(await store.isPresent()).toBe(true);

    const emittedEvents: unknown[] = [];
    eventBus.subscribeGlobal((ev) => emittedEvents.push(ev));

    // 2. Start login
    const session = await service.startLogin({ saveAs: 'new-acc' });
    expect(session.loginId).toBeDefined();
    expect(session.status).toBe('awaiting_browser');
    expect(session.authUrl).toBeNull();

    // While awaiting, live credentials should be cleared
    expect(await store.isPresent()).toBe(false);

    // And write lock is held
    expect(lock.isWriting).toBe(true);

    // 3. Simulate user finishing login in terminal (credentials written to keyring)
    setTimeout(() => {
      keyring.set('gemini:antigravity', makeCredJson('user-new', 'new@example.com'));
    }, 40);

    // 4. Wait for login completion
    const finalSession = await service.waitForLoginCompletion(session.loginId);
    expect(finalSession.status).toBe('completed');
    expect(finalSession.email).toBe('new@example.com');
    expect(finalSession.error).toBeNull();

    // 5. Verify account saved in DB
    const saved = accountsRepo.findByName('new-acc');
    expect(saved).toBeDefined();
    expect(saved?.email).toBe('new@example.com');
    expect(saved?.active).toBe(true);

    // 6. Verify snapshot saved to disk
    expect(store.hasSnapshot('new-acc')).toBe(true);
    const loadedSnapshot = await store.loadSnapshot('new-acc');
    expect(loadedSnapshot.targets['gemini:antigravity']).toBeDefined();

    // 7. Verify global event broadcasted
    expect(emittedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'account.changed',
          whoami: expect.objectContaining({
            activeProfile: 'new-acc',
            email: 'new@example.com',
          }),
        }),
      ]),
    );

    // 8. Terminal handle was cancelled/closed
    expect(loginPort.killMock).toHaveBeenCalled();

    // 9. Write lock is released
    expect(lock.isWriting).toBe(false);
    expect(() => lock.acquireWriteLease().release()).not.toThrow();

    // 10. Live credentials remain the new account credentials
    const liveClaims = await store.readLiveClaims();
    expect(liveClaims?.email).toBe('new@example.com');
  });

  it('user cancels login: restores previous live credentials, cancels terminal, and releases write lock', async () => {
    // 1. Initial live credentials
    keyring.set('gemini:antigravity', makeCredJson('user-orig', 'orig@example.com'));

    // 2. Start login
    const session = await service.startLogin({ saveAs: 'cancelled-acc' });
    expect(session.status).toBe('awaiting_browser');
    expect(await store.isPresent()).toBe(false);
    expect(lock.isWriting).toBe(true);

    // 3. User cancels
    const cancelled = await service.cancelLogin(session.loginId);
    expect(cancelled.status).toBe('cancelled');

    // 4. Previous credentials restored
    expect(await store.isPresent()).toBe(true);
    const liveClaims = await store.readLiveClaims();
    expect(liveClaims?.email).toBe('orig@example.com');

    // 5. Terminal killed and write lock released
    expect(loginPort.killMock).toHaveBeenCalled();
    expect(lock.isWriting).toBe(false);
    expect(() => lock.acquireWriteLease().release()).not.toThrow();

    // 6. Repeating cancelLogin is safe
    const reCancelled = await service.cancelLogin(session.loginId);
    expect(reCancelled.status).toBe('cancelled');
  });

  it('login timeout: automatically cancels, restores previous credentials, and releases write lock', async () => {
    // 1. Initial live credentials
    keyring.set('gemini:antigravity', makeCredJson('user-prev', 'prev@example.com'));

    // 2. Start login with short timeout configured (200ms)
    const session = await service.startLogin({ saveAs: 'timeout-acc' });
    expect(session.status).toBe('awaiting_browser');

    // 3. Wait for timeout
    const finalSession = await service.waitForLoginCompletion(session.loginId);
    expect(finalSession.status).toBe('cancelled');
    expect(finalSession.error).toBe('Login timed out');

    // 4. Backup restored
    expect(await store.isPresent()).toBe(true);
    const liveClaims = await store.readLiveClaims();
    expect(liveClaims?.email).toBe('prev@example.com');

    // 5. Terminal cancelled and write lock released
    expect(loginPort.killMock).toHaveBeenCalled();
    expect(lock.isWriting).toBe(false);
  });

  it('service close / cancelActiveLogin restores credentials and releases lock', async () => {
    keyring.set('gemini:antigravity', makeCredJson('user-shutdown', 'shutdown@example.com'));

    const session = await service.startLogin({ saveAs: 'shutdown-acc' });
    expect(session.status).toBe('awaiting_browser');
    expect(lock.isWriting).toBe(true);

    // Trigger service close
    await service.close();

    const currentSession = service.getLoginSession(session.loginId);
    expect(currentSession.status).toBe('cancelled');

    // Original credentials restored
    const liveClaims = await store.readLiveClaims();
    expect(liveClaims?.email).toBe('shutdown@example.com');

    // Lock released
    expect(lock.isWriting).toBe(false);
  });

  it('rejects concurrent login while one is in progress', async () => {
    await service.startLogin({ saveAs: 'first-acc' });

    // Second login should be rejected with ACCOUNT_SWITCH_IN_PROGRESS
    await expect(service.startLogin({ saveAs: 'second-acc' })).rejects.toThrowError(
      expect.objectContaining({
        code: 'ACCOUNT_SWITCH_IN_PROGRESS',
      }),
    );
  });

  it('rejects startLogin when reader lock is active with ACCOUNT_BUSY', async () => {
    const readLease = lock.acquireReadLease();
    expect(lock.readers).toBe(1);

    await expect(service.startLogin({ saveAs: 'busy-acc' })).rejects.toThrowError(
      expect.objectContaining({
        code: 'ACCOUNT_BUSY',
      }),
    );

    readLease.release();
    expect(lock.readers).toBe(0);

    // Once released, startLogin works
    const session = await service.startLogin({ saveAs: 'busy-acc' });
    expect(session.status).toBe('awaiting_browser');
  });

  it('rejects startLogin with BAD_REQUEST if saveAs is missing or empty', async () => {
    await expect(service.startLogin({ saveAs: '' })).rejects.toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
      }),
    );

    await expect(service.startLogin({ saveAs: '   ' })).rejects.toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
      }),
    );
  });

  it('recovers properly if startLogin fails during startup', async () => {
    keyring.set('gemini:antigravity', makeCredJson('user-fail', 'fail@example.com'));
    loginPort.failStart = true;

    await expect(service.startLogin({ saveAs: 'fail-acc' })).rejects.toThrow();

    // Previous credentials should still be restored
    expect(await store.isPresent()).toBe(true);
    const liveClaims = await store.readLiveClaims();
    expect(liveClaims?.email).toBe('fail@example.com');

    // Lock released
    expect(lock.isWriting).toBe(false);
  });

  it('handles fluctuating credentials and only completes when double reads match', async () => {
    const session = await service.startLogin({ saveAs: 'fluctuating-acc' });

    // 1. Initial write with first token
    keyring.set('gemini:antigravity', makeCredJson('user-1', 'step1@example.com'));

    // 2. Quickly update before settle
    setTimeout(() => {
      keyring.set('gemini:antigravity', makeCredJson('user-final', 'final@example.com'));
    }, 45);

    const finalSession = await service.waitForLoginCompletion(session.loginId);
    expect(finalSession.status).toBe('completed');
    expect(finalSession.email).toBe('final@example.com');
  });

  it('getLoginSession returns current session or throws NOT_FOUND', async () => {
    const session = await service.startLogin({ saveAs: 'query-acc' });

    const retrieved = service.getLoginSession(session.loginId);
    expect(retrieved.loginId).toBe(session.loginId);
    expect(retrieved.status).toBe('awaiting_browser');

    expect(() => service.getLoginSession('non-existent-id')).toThrowError(
      expect.objectContaining({
        code: 'NOT_FOUND',
      }),
    );
  });
});
