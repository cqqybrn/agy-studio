import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { AccountLoginSession, ApiErrorResponse } from '@agy-studio/contracts';
import {
  createDatabase,
  AccountsRepository,
  EventsRepository,
} from '../../src/repositories/index.js';
import { CredentialStore } from '../../src/integrations/agy/credential-store.js';
import { MemoryWinCred } from '../../src/integrations/agy/wincred.js';
import { MemoryDpapi } from '../../src/integrations/agy/dpapi.js';
import { AccountService } from '../../src/services/account/account.js';
import { AccountLeaseLock } from '../../src/services/account/lease-lock.js';
import { EventBus } from '../../src/services/event-bus.js';
import { accountsRoutes } from '../../src/routes/http/accounts.routes.js';
import type { LoginPort, LoginHandle } from '../../src/services/ports/login.port.js';

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

class FakeLoginPort implements LoginPort {
  async startLogin(options: { accountName: string }): Promise<LoginHandle> {
    const loginId = `login_rt_${Date.now()}`;
    let session: AccountLoginSession = {
      loginId,
      status: 'awaiting_browser',
      authUrl: null,
      email: null,
      error: null,
    };

    return {
      loginId,
      get session() {
        return session;
      },
      waitForAuthUrl: async () => '',
      waitForCompletion: async () => session,
      cancel: async () => {
        session = { ...session, status: 'cancelled' };
      },
    };
  }
}

describe('Accounts Login HTTP Routes', () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let tempDir: string;
  let accountsRepo: AccountsRepository;
  let eventsRepo: EventsRepository;
  let eventBus: EventBus;
  let keyring: MemoryWinCred;
  let dpapi: MemoryDpapi;
  let store: CredentialStore;
  let lock: AccountLeaseLock;
  let accountService: AccountService;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-accounts-login-route-'));

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

    accountService = new AccountService({
      accountsRepo,
      credentialStore: store,
      leaseLock: lock,
      loginPort: new FakeLoginPort(),
      eventBus,
      loginPollIntervalMs: 20,
      loginSettleDelayMs: 30,
      loginTimeoutMs: 300,
    });

    app = Fastify();
    await app.register(accountsRoutes, { accountService });
    await app.ready();
  });

  afterEach(async () => {
    await accountService.close();
    await app.close();
    db.close();
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('POST /api/accounts/login starts login session successfully', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/accounts/login',
      payload: { saveAs: 'route-test-acc' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<AccountLoginSession>();
    expect(body.loginId).toMatch(/^login_rt_/);
    expect(body.status).toBe('awaiting_browser');
    expect(body.authUrl).toBeNull();
  });

  it('POST /api/accounts/login rejects missing or invalid saveAs with 400', async () => {
    const resEmpty = await app.inject({
      method: 'POST',
      url: '/api/accounts/login',
      payload: { saveAs: '' },
    });
    expect(resEmpty.statusCode).toBe(400);
    const errBody = resEmpty.json<ApiErrorResponse>();
    expect(errBody.error.code).toBe('BAD_REQUEST');

    const resNoBody = await app.inject({
      method: 'POST',
      url: '/api/accounts/login',
      payload: {},
    });
    expect(resNoBody.statusCode).toBe(400);
  });

  it('POST /api/accounts/login rejects concurrent login with 423', async () => {
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/accounts/login',
      payload: { saveAs: 'first' },
    });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/accounts/login',
      payload: { saveAs: 'second' },
    });
    expect(res2.statusCode).toBe(423);
    const errBody = res2.json<ApiErrorResponse>();
    expect(errBody.error.code).toBe('ACCOUNT_SWITCH_IN_PROGRESS');
  });

  it('GET /api/accounts/login/:loginId returns current session or 404', async () => {
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/accounts/login',
      payload: { saveAs: 'query-login' },
    });
    const session = startRes.json<AccountLoginSession>();

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/accounts/login/${session.loginId}`,
    });
    expect(getRes.statusCode).toBe(200);
    const retrieved = getRes.json<AccountLoginSession>();
    expect(retrieved.loginId).toBe(session.loginId);
    expect(retrieved.status).toBe('awaiting_browser');

    // 404 for unknown loginId
    const notFoundRes = await app.inject({
      method: 'GET',
      url: '/api/accounts/login/unknown_id',
    });
    expect(notFoundRes.statusCode).toBe(404);
    expect(notFoundRes.json<ApiErrorResponse>().error.code).toBe('NOT_FOUND');
  });

  it('DELETE /api/accounts/login/:loginId cancels login session', async () => {
    // Put live credentials
    keyring.set('gemini:antigravity', makeCredJson('user-before', 'before@example.com'));

    const startRes = await app.inject({
      method: 'POST',
      url: '/api/accounts/login',
      payload: { saveAs: 'to-cancel' },
    });
    const session = startRes.json<AccountLoginSession>();

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/accounts/login/${session.loginId}`,
    });
    expect(delRes.statusCode).toBe(200);
    const cancelled = delRes.json<AccountLoginSession>();
    expect(cancelled.status).toBe('cancelled');

    // Credentials restored
    expect(await store.isPresent()).toBe(true);
    const liveClaims = await store.readLiveClaims();
    expect(liveClaims?.email).toBe('before@example.com');

    // 404 on deleting non-existent login
    const notFoundRes = await app.inject({
      method: 'DELETE',
      url: '/api/accounts/login/non-existent-login-id',
    });
    expect(notFoundRes.statusCode).toBe(404);
  });

  it('full login flow through routes: start -> credentials detected -> completed in GET', async () => {
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/accounts/login',
      payload: { saveAs: 'e2e-account' },
    });
    expect(startRes.statusCode).toBe(200);
    const { loginId } = startRes.json<AccountLoginSession>();

    // Set new credentials
    setTimeout(() => {
      keyring.set('gemini:antigravity', makeCredJson('e2e-sub', 'e2e@example.com'));
    }, 40);

    // Wait for completion via accountService helper
    await accountService.waitForLoginCompletion(loginId);

    // GET should return completed
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/accounts/login/${loginId}`,
    });
    expect(getRes.statusCode).toBe(200);
    const completedSession = getRes.json<AccountLoginSession>();
    expect(completedSession.status).toBe('completed');
    expect(completedSession.email).toBe('e2e@example.com');

    // Accounts list endpoint includes the new account
    const accountsRes = await app.inject({
      method: 'GET',
      url: '/api/accounts',
    });
    expect(accountsRes.statusCode).toBe(200);
    const { accounts, whoami } = accountsRes.json<{
      accounts: Array<{ name: string; email: string | null; active: boolean }>;
      whoami: { activeProfile: string | null; email: string | null };
    }>();
    const created = accounts.find((a) => a.name === 'e2e-account');
    expect(created).toBeDefined();
    expect(created?.email).toBe('e2e@example.com');
    expect(created?.active).toBe(true);
    expect(whoami.activeProfile).toBe('e2e-account');
  });
});
