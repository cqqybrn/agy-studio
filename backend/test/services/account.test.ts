import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createDatabase, AccountsRepository, EventsRepository } from '../../src/repositories/index.js';
import { CredentialStore } from '../../src/integrations/agy/credential-store.js';
import { MemoryWinCred } from '../../src/integrations/agy/wincred.js';
import { MemoryDpapi } from '../../src/integrations/agy/dpapi.js';
import { AccountService } from '../../src/services/account/account.js';
import { AccountLeaseLock } from '../../src/services/account/lease-lock.js';
import { EventBus } from '../../src/services/event-bus.js';
import { AppError } from '../../src/utils/errors.js';

function createFakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.signature`;
}

function makeCredJson(sub: string, email: string, refreshToken = 'ref-123'): Buffer {
  return Buffer.from(
    JSON.stringify({
      token: {
        access_token: 'acc-token-' + sub,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expiry: '2026-09-28T22:00:00.0000000Z',
      },
      auth_method: 'consumer',
      id_token: createFakeJwt({ sub, email }),
    }),
  );
}

describe('AccountService and LeaseLock', () => {
  let db: Database.Database;
  let tempDir: string;
  let accountsRepo: AccountsRepository;
  let eventsRepo: EventsRepository;
  let eventBus: EventBus;
  let keyring: MemoryWinCred;
  let dpapi: MemoryDpapi;
  let store: CredentialStore;
  let lock: AccountLeaseLock;
  let service: AccountService;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-account-test-'));
    accountsRepo = new AccountsRepository(db);
    eventsRepo = new EventsRepository(db);
    eventBus = new EventBus({ eventsRepo });
    keyring = new MemoryWinCred();
    dpapi = new MemoryDpapi();
    lock = new AccountLeaseLock();

    store = new CredentialStore({
      dataDir: tempDir,
      wincred: keyring,
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
      eventBus,
    });
  });

  afterEach(async () => {
    db.close();
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('AccountLeaseLock concurrency', () => {
    it('allows concurrent read leases', () => {
      const lease1 = lock.acquireRead();
      const lease2 = lock.acquireRead();
      expect(lock.readers).toBe(2);

      lease1.release();
      expect(lock.readers).toBe(1);
      lease2.release();
      expect(lock.readers).toBe(0);
    });

    it('rejects write lease when read lease is held with ACCOUNT_BUSY', () => {
      const readLease = lock.acquireRead();
      expect(() => lock.acquireWrite()).toThrow(AppError);
      try {
        lock.acquireWrite();
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('ACCOUNT_BUSY');
      }
      readLease.release();

      // Now write should succeed
      const writeLease = lock.acquireWrite();
      expect(lock.isWriting).toBe(true);
      writeLease.release();
    });

    it('rejects read lease when write lease is held with ACCOUNT_SWITCH_IN_PROGRESS', () => {
      const writeLease = lock.acquireWrite();
      expect(() => lock.acquireRead()).toThrow(AppError);
      try {
        lock.acquireRead();
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('ACCOUNT_SWITCH_IN_PROGRESS');
      }
      writeLease.release();

      // Now read should succeed
      const readLease = lock.acquireRead();
      expect(lock.readers).toBe(1);
      readLease.release();
    });

    it('rejects second write lease when write lease is held with ACCOUNT_SWITCH_IN_PROGRESS', () => {
      const writeLease1 = lock.acquireWrite();
      expect(() => lock.acquireWrite()).toThrow(AppError);
      try {
        lock.acquireWrite();
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('ACCOUNT_SWITCH_IN_PROGRESS');
      }
      writeLease1.release();
    });

    it('registerWaitingWriter prevents new read leases from being acquired', () => {
      const cancelWriter = lock.registerWaitingWriter();
      expect(lock.waitingWriters).toBe(1);
      expect(() => lock.acquireRead()).toThrow(AppError);
      cancelWriter();
      expect(lock.waitingWriters).toBe(0);
      const readLease = lock.acquireRead();
      expect(lock.readers).toBe(1);
      readLease.release();
    });
  });

  describe('whoami and listAccounts', () => {
    it('returns empty whoami when no credentials exist', async () => {
      const info = await service.whoami();
      expect(info.credentialPresent).toBe(false);
      expect(info.activeProfile).toBeNull();
      expect(info.email).toBeNull();
    });

    it('returns whoami with live claims when credentials exist', async () => {
      keyring.set('gemini:antigravity', makeCredJson('user-1', 'user1@example.com'));

      await service.saveAccount({ name: 'main-acc' });
      const info = await service.whoami();

      expect(info.credentialPresent).toBe(true);
      expect(info.activeProfile).toBe('main-acc');
      expect(info.email).toBe('user1@example.com');
      expect(info.isolation).toBe('credential_snapshot');
    });

    it('listAccounts associates active runs count', async () => {
      const supervisorMock = {
        activeRuns: () => [
          { accountName: 'acc-1' },
          { accountName: 'acc-1' },
          { accountName: 'acc-2' },
        ],
      };
      const customService = new AccountService({
        accountsRepo,
        credentialStore: store,
        runSupervisor: supervisorMock,
      });

      accountsRepo.save({
        name: 'acc-1',
        type: 'oauth',
        isolation: 'credential_snapshot',
        email: 'acc1@test.com',
        note: null,
        savedAt: new Date().toISOString(),
        active: true,
      });
      accountsRepo.save({
        name: 'acc-2',
        type: 'oauth',
        isolation: 'credential_snapshot',
        email: 'acc2@test.com',
        note: null,
        savedAt: new Date().toISOString(),
        active: false,
      });

      const list = await customService.listAccounts();
      expect(list).toHaveLength(2);
      const acc1 = list.find((a) => a.name === 'acc-1');
      const acc2 = list.find((a) => a.name === 'acc-2');
      expect(acc1?.activeRuns).toBe(2);
      expect(acc2?.activeRuns).toBe(1);
    });
  });

  describe('saveAccount & deleteAccount', () => {
    it('saves account metadata and snapshots live credential to disk', async () => {
      keyring.set('gemini:antigravity', makeCredJson('sub-abc', 'abc@example.com'));

      const saved = await service.saveAccount({ name: 'acc-abc', note: 'My work account' });
      expect(saved.name).toBe('acc-abc');
      expect(saved.email).toBe('abc@example.com');
      expect(saved.active).toBe(true);

      expect(store.hasSnapshot('acc-abc')).toBe(true);
    });

    it('requires apiKey when account type is apikey', async () => {
      await expect(service.saveAccount({ name: 'api-acc', type: 'apikey' })).rejects.toThrow(
        AppError,
      );
    });

    it('acquires read lease and rejects when write lease is held (ACCOUNT_SWITCH_IN_PROGRESS)', async () => {
      const writeLease = lock.acquireWrite();
      await expect(service.saveAccount({ name: 'should-fail' })).rejects.toThrow(AppError);
      try {
        await service.saveAccount({ name: 'should-fail' });
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('ACCOUNT_SWITCH_IN_PROGRESS');
      }
      writeLease.release();
    });

    it('deleteAccount clears live credentials if deleting the active account', async () => {
      keyring.set('gemini:antigravity', makeCredJson('sub-del', 'del@example.com'));
      await service.saveAccount({ name: 'to-delete' });
      expect(await store.isPresent()).toBe(true);

      await service.deleteAccount('to-delete');
      expect(await store.isPresent()).toBe(false);
      expect(accountsRepo.findByName('to-delete')).toBeNull();
      expect(store.hasSnapshot('to-delete')).toBe(false);
    });
  });

  describe('switchAccount', () => {
    it('successfully switches account and publishes event', async () => {
      // 1. Prepare Account A as current live
      keyring.set('gemini:antigravity', makeCredJson('sub-a', 'a@example.com'));
      await service.saveAccount({ name: 'acc-a' });

      // 2. Prepare Account B credentials and snapshot
      keyring.set('gemini:antigravity', makeCredJson('sub-b', 'b@example.com'));
      await service.saveAccount({ name: 'acc-b' });

      // Switch back to A in keyring to start test
      keyring.set('gemini:antigravity', makeCredJson('sub-a', 'a@example.com'));
      accountsRepo.setDefault('acc-a');

      // Listen for account.changed
      const events: unknown[] = [];
      eventBus.subscribeGlobal((ev) => {
        if (ev.type === 'account.changed') events.push(ev);
      });

      // Switch from A to B
      const result = await service.switchAccount('acc-b');
      expect(result.whoami.activeProfile).toBe('acc-b');
      expect(result.whoami.email).toBe('b@example.com');

      // Keyring should now hold account B's credentials
      const liveClaims = await store.readLiveClaims();
      expect(liveClaims?.sub).toBe('sub-b');
      expect(liveClaims?.email).toBe('b@example.com');

      // Active account in repository should be acc-b
      expect(accountsRepo.findDefault()?.name).toBe('acc-b');

      // Global event should have been published
      expect(events).toHaveLength(1);
    });

    it('rejects switch when active run holds read lease (ACCOUNT_BUSY)', async () => {
      keyring.set('gemini:antigravity', makeCredJson('sub-a', 'a@example.com'));
      await service.saveAccount({ name: 'acc-a' });

      const lease = service.acquireLease('acc-a');
      expect(lock.readers).toBe(1);

      await expect(service.switchAccount('acc-a')).rejects.toThrow(AppError);

      try {
        await service.switchAccount('acc-a');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('ACCOUNT_BUSY');
      }

      lease.release();
    });

    it('rolls back to previous live credential if restore validation fails', async () => {
      // Setup live account A
      keyring.set('gemini:antigravity', makeCredJson('sub-orig', 'orig@example.com'));
      await service.saveAccount({ name: 'orig-acc' });

      // Create snapshot for corrupted account B where secret sub doesn't match
      const corruptedCred = Buffer.from(
        JSON.stringify({
          token: { access_token: 'corrupt', refresh_token: 'corrupt' },
          id_token: createFakeJwt({ sub: 'sub-wrong-mismatch', email: 'b@example.com' }),
        }),
      );

      // Save acc-b in DB
      accountsRepo.save({
        name: 'acc-b',
        type: 'oauth',
        isolation: 'credential_snapshot',
        email: 'b@example.com',
        note: null,
        savedAt: new Date().toISOString(),
        active: false,
      });

      // Create snapshot on disk for acc-b with target expecting sub-b
      // but write fake secret with sub-corrupt-live
      await store.snapshot('acc-b');

      // Mock readLiveClaims during verification to simulate mismatch
      const origReadLiveClaims = store.readLiveClaims.bind(store);
      vi.spyOn(store, 'readLiveClaims').mockResolvedValue({
        sub: 'different-live-sub',
        email: 'diff@example.com',
      });

      // Attempt switch, should fail and rollback
      await expect(service.switchAccount('acc-b')).rejects.toThrow(AppError);

      // Verify rollback: restore original claims spy and check keyring
      vi.spyOn(store, 'readLiveClaims').mockImplementation(origReadLiveClaims);
      const restoredSecret = keyring.get('gemini:antigravity');
      expect(restoredSecret?.length).toBeGreaterThan(0);
      const claims = await origReadLiveClaims();
      expect(claims?.email).toBe('orig@example.com');
    });

    it('fails and rolls back if restored live credential is missing sub when target has sub', async () => {
      keyring.set('gemini:antigravity', makeCredJson('sub-valid', 'valid@example.com'));
      await service.saveAccount({ name: 'valid-acc' });

      keyring.set('gemini:antigravity', makeCredJson('sub-target', 'target@example.com'));
      await service.saveAccount({ name: 'target-acc' });

      // Switch back to valid-acc
      keyring.set('gemini:antigravity', makeCredJson('sub-valid', 'valid@example.com'));
      accountsRepo.setDefault('valid-acc');

      // Mock readLiveClaims returning null sub (e.g. broken live token)
      vi.spyOn(store, 'readLiveClaims').mockResolvedValueOnce({
        sub: undefined as any,
        email: 'target@example.com',
      });

      await expect(service.switchAccount('target-acc')).rejects.toThrow(AppError);

      // Verify rollback occurred
      const claims = await store.readLiveClaims();
      expect(claims?.email).toBe('valid@example.com');
    });

    async function writeRawSnapshot(accountName: string, targets: Record<string, string>): Promise<void> {
      accountsRepo.save({
        name: accountName,
        type: 'oauth',
        isolation: 'credential_snapshot',
        email: null,
        note: null,
        savedAt: new Date().toISOString(),
        active: false,
      });
      const snapshotPath = store.getSnapshotPath(accountName);
      await fs.promises.mkdir(path.dirname(snapshotPath), { recursive: true });
      const raw = Buffer.from(JSON.stringify({ version: 1, createdAt: '', targets, files: {} }), 'utf-8');
      await fs.promises.writeFile(snapshotPath, await dpapi.protect(raw));
    }

    it.each([
      ['an empty target payload', { 'gemini:antigravity': '' }],
      ['no targets at all', {}],
    ])('keeps live credentials untouched when the target snapshot has %s', async (_label, targets) => {
      const live = makeCredJson('sub-live', 'live@example.com');
      keyring.set('gemini:antigravity', live, 'antigravity');
      await service.saveAccount({ name: 'live-acc' });
      await writeRawSnapshot('empty-acc', targets);

      const writeSpy = vi.spyOn(keyring, 'write');
      const deleteSpy = vi.spyOn(keyring, 'delete');

      await expect(service.switchAccount('empty-acc')).rejects.toThrow(AppError);

      expect(writeSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(keyring.get('gemini:antigravity')?.equals(live)).toBe(true);
      expect(accountsRepo.findDefault()?.name).toBe('live-acc');
      expect(lock.isWriting).toBe(false);
    });

    it('rolls back to the live backup when the restore write itself fails', async () => {
      const live = makeCredJson('sub-live', 'live@example.com');
      keyring.set('gemini:antigravity', makeCredJson('sub-t', 't@example.com'), 'antigravity');
      await service.saveAccount({ name: 'target-acc' });
      keyring.set('gemini:antigravity', live, 'antigravity');

      const realWrite = keyring.write.bind(keyring);
      let calls = 0;
      vi.spyOn(keyring, 'write').mockImplementation(async (target, userName, data) => {
        calls++;
        if (calls === 1) throw new AppError('INTERNAL', 'simulated CredWrite failure');
        return realWrite(target, userName, data);
      });

      await expect(service.switchAccount('target-acc')).rejects.toThrow('simulated CredWrite failure');
      expect(calls).toBe(2);
      expect(keyring.get('gemini:antigravity')?.equals(live)).toBe(true);
    });
  });

  describe('onRunCompleted hook', () => {
    it('snapshots updated live credentials back to account snapshot', async () => {
      keyring.set('gemini:antigravity', makeCredJson('sub-sync', 'sync@example.com', 'initial-refresh'));
      await service.saveAccount({ name: 'sync-acc' });

      // Simulate agy refreshing the token during run
      keyring.set('gemini:antigravity', makeCredJson('sub-sync', 'sync@example.com', 'new-refreshed-token'));

      await service.onRunCompleted('sync-acc');

      // The snapshot on disk should now contain the new refreshed token
      const reloaded = await store.loadSnapshot('sync-acc');
      const payload = Buffer.from(reloaded.targets['gemini:antigravity'], 'base64').toString('utf-8');
      expect(payload).toContain('new-refreshed-token');
    });
  });

  describe('No secrets in responses or logs', () => {
    it('listAccounts and whoami do not contain token or secret fields', async () => {
      keyring.set('gemini:antigravity', makeCredJson('sub-sec', 'sec@example.com'));
      await service.saveAccount({ name: 'sec-acc' });

      const whoami = await service.whoami();
      const accounts = await service.listAccounts();

      const whoamiStr = JSON.stringify(whoami);
      const accountsStr = JSON.stringify(accounts);

      expect(whoamiStr).not.toContain('acc-token');
      expect(whoamiStr).not.toContain('refresh_token');
      expect(whoamiStr).not.toContain('access_token');

      expect(accountsStr).not.toContain('acc-token');
      expect(accountsStr).not.toContain('refresh_token');
      expect(accountsStr).not.toContain('access_token');
    });
  });
});
