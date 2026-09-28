import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { Account, WhoAmI } from '@agy-studio/contracts';
import { createDatabase, AccountsRepository, EventsRepository } from '../../src/repositories/index.js';
import {
  CredentialStore,
  MemoryKeyringProvider,
} from '../../src/integrations/agy/credential-store.js';
import { MemoryDpapi } from '../../src/integrations/agy/dpapi.js';
import { AccountService } from '../../src/services/account/account.js';
import { AccountLeaseLock } from '../../src/services/account/lease-lock.js';
import { EventBus } from '../../src/services/event-bus.js';
import { accountsRoutes } from '../../src/routes/http/accounts.routes.js';

function createFakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
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

describe('Accounts HTTP Routes', () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let tempDir: string;
  let accountsRepo: AccountsRepository;
  let eventsRepo: EventsRepository;
  let eventBus: EventBus;
  let keyring: MemoryKeyringProvider;
  let dpapi: MemoryDpapi;
  let store: CredentialStore;
  let lock: AccountLeaseLock;
  let accountService: AccountService;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-accounts-route-test-'));

    accountsRepo = new AccountsRepository(db);
    eventsRepo = new EventsRepository(db);
    eventBus = new EventBus({ eventsRepo });
    keyring = new MemoryKeyringProvider();
    dpapi = new MemoryDpapi();
    lock = new AccountLeaseLock();

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

    accountService = new AccountService({
      accountsRepo,
      credentialStore: store,
      leaseLock: lock,
      eventBus,
    });

    app = Fastify();
    await app.register(accountsRoutes, { accountService });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('GET /api/accounts', () => {
    it('returns empty list and empty whoami when no accounts exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/accounts',
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body) as { accounts: Account[]; whoami: WhoAmI };
      expect(data.accounts).toEqual([]);
      expect(data.whoami.activeProfile).toBeNull();
      expect(data.whoami.credentialPresent).toBe(false);
    });

    it('returns accounts and whoami with live claims', async () => {
      keyring.set('gemini:antigravity', makeCredJson('sub-1', 'user1@gmail.com'));
      await accountService.saveAccount({ name: 'profile-1' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/accounts',
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body) as { accounts: Account[]; whoami: WhoAmI };
      expect(data.accounts).toHaveLength(1);
      expect(data.accounts[0].name).toBe('profile-1');
      expect(data.accounts[0].active).toBe(true);
      expect(data.whoami.activeProfile).toBe('profile-1');
      expect(data.whoami.email).toBe('user1@gmail.com');
      expect(data.whoami.credentialPresent).toBe(true);
    });
  });

  describe('POST /api/accounts/save', () => {
    it('saves new account and returns 200 with Account domain model', async () => {
      keyring.set('gemini:antigravity', makeCredJson('sub-2', 'user2@gmail.com'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/accounts/save',
        payload: {
          name: 'profile-2',
          note: 'Primary work profile',
          type: 'oauth',
        },
      });

      expect(res.statusCode).toBe(200);
      const acc = JSON.parse(res.body) as Account;
      expect(acc.name).toBe('profile-2');
      expect(acc.note).toBe('Primary work profile');
      expect(acc.email).toBe('user2@gmail.com');
      expect(acc.active).toBe(true);
    });

    it('rejects save with empty name with 400 BAD_REQUEST', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/accounts/save',
        payload: {
          name: '   ',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('rejects apikey type without apiKey with 400 BAD_REQUEST', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/accounts/save',
        payload: {
          name: 'my-apikey-acc',
          type: 'apikey',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('POST /api/accounts/switch', () => {
    it('switches account and returns updated whoami', async () => {
      keyring.set('gemini:antigravity', makeCredJson('sub-a', 'a@test.com'));
      await accountService.saveAccount({ name: 'acc-a' });

      keyring.set('gemini:antigravity', makeCredJson('sub-b', 'b@test.com'));
      await accountService.saveAccount({ name: 'acc-b' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/accounts/switch',
        payload: { name: 'acc-a' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { whoami: WhoAmI };
      expect(body.whoami.activeProfile).toBe('acc-a');
      expect(body.whoami.email).toBe('a@test.com');
    });

    it('returns 409 ACCOUNT_BUSY when read lease is active during switch', async () => {
      keyring.set('gemini:antigravity', makeCredJson('sub-a', 'a@test.com'));
      await accountService.saveAccount({ name: 'acc-a' });

      const lease = accountService.acquireLease('acc-a');

      const res = await app.inject({
        method: 'POST',
        url: '/api/accounts/switch',
        payload: { name: 'acc-a' },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('ACCOUNT_BUSY');

      lease.release();
    });

    it('returns 404 ACCOUNT_NOT_FOUND when target account does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/accounts/switch',
        payload: { name: 'non-existent' },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');
    });
  });

  describe('DELETE /api/accounts/:name', () => {
    it('deletes account and returns ok: true', async () => {
      keyring.set('gemini:antigravity', makeCredJson('sub-del', 'del@test.com'));
      await accountService.saveAccount({ name: 'acc-del' });

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/accounts/acc-del',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);

      const afterRes = await app.inject({
        method: 'GET',
        url: '/api/accounts',
      });
      const data = JSON.parse(afterRes.body) as { accounts: Account[] };
      expect(data.accounts).toHaveLength(0);
    });

    it('returns 404 ACCOUNT_NOT_FOUND when deleting unknown account', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/accounts/not-here',
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');
    });

    it('returns 409 ACCOUNT_BUSY when deleting while read lease is active', async () => {
      keyring.set('gemini:antigravity', makeCredJson('sub-busy', 'busy@test.com'));
      await accountService.saveAccount({ name: 'acc-busy' });

      const lease = accountService.acquireLease('acc-busy');

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/accounts/acc-busy',
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('ACCOUNT_BUSY');

      lease.release();
    });
  });
});
