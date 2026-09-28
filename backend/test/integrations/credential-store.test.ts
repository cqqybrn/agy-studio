import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CredentialStore,
  MemoryKeyringProvider,
  extractClaimsFromSecret,
  extractClaimsFromSnapshot,
  parseJwtPayload,
} from '../../src/integrations/agy/credential-store.js';
import { MemoryDpapi } from '../../src/integrations/agy/dpapi.js';
import { AppError } from '../../src/utils/errors.js';

function createFakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = 'fake-sig';
  return `${header}.${payload}.${signature}`;
}

describe('CredentialStore Integration', () => {
  let tempDir: string;
  let keyring: MemoryKeyringProvider;
  let dpapi: MemoryDpapi;
  let store: CredentialStore;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-cred-test-'));
    keyring = new MemoryKeyringProvider();
    dpapi = new MemoryDpapi();
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
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('isPresent returns false when keyring is empty', async () => {
    expect(await store.isPresent()).toBe(false);
  });

  it('isPresent returns true when keyring target has data', async () => {
    keyring.set('gemini:antigravity', Buffer.from('some-secret'));
    expect(await store.isPresent()).toBe(true);
  });

  it('snapshot encrypts data and writes to disk, loadSnapshot reads it back', async () => {
    const fakeTokenPayload = {
      token: {
        access_token: 'acc-123',
        refresh_token: 'ref-456',
      },
      id_token: createFakeJwt({ sub: 'user-sub-1', email: 'test@example.com' }),
    };
    keyring.set('gemini:antigravity', Buffer.from(JSON.stringify(fakeTokenPayload)));

    const snapshot = await store.snapshot('acc-main');
    expect(snapshot.version).toBe(1);
    expect(snapshot.targets['gemini:antigravity']).toBeDefined();

    expect(store.hasSnapshot('acc-main')).toBe(true);

    const loaded = await store.loadSnapshot('acc-main');
    expect(loaded.targets['gemini:antigravity']).toBe(snapshot.targets['gemini:antigravity']);

    // Clear live
    await store.clear();
    expect(await store.isPresent()).toBe(false);

    // Restore
    await store.restore(loaded);
    expect(await store.isPresent()).toBe(true);

    const liveClaims = await store.readLiveClaims();
    expect(liveClaims?.sub).toBe('user-sub-1');
    expect(liveClaims?.email).toBe('test@example.com');
  });

  it('clear deletes the keyring entry', async () => {
    keyring.set('gemini:antigravity', Buffer.from('secret'));
    expect(await store.isPresent()).toBe(true);
    await store.clear();
    expect(await store.isPresent()).toBe(false);
  });

  it('deleteSnapshot removes snapshot folder from disk', async () => {
    keyring.set('gemini:antigravity', Buffer.from('secret'));
    await store.snapshot('to-delete');
    expect(store.hasSnapshot('to-delete')).toBe(true);

    await store.deleteSnapshot('to-delete');
    expect(store.hasSnapshot('to-delete')).toBe(false);
  });

  it('loadSnapshot throws NOT_FOUND for non-existent snapshot', async () => {
    await expect(store.loadSnapshot('non-existent')).rejects.toThrow(AppError);
  });

  it('JWT extraction extracts sub and email accurately without signature', () => {
    const claims = { sub: 'google-sub-999', email: 'alice@google.com', name: 'Alice' };
    const jwt = createFakeJwt(claims);
    const parsed = parseJwtPayload(jwt);
    expect(parsed?.sub).toBe('google-sub-999');
    expect(parsed?.email).toBe('alice@google.com');

    const secretBytes = Buffer.from(JSON.stringify({ id_token: jwt }));
    const extracted = extractClaimsFromSecret(secretBytes);
    expect(extracted?.sub).toBe('google-sub-999');
    expect(extracted?.email).toBe('alice@google.com');

    const snapshot = {
      version: 1,
      createdAt: '',
      targets: { 'gemini:antigravity': secretBytes.toString('base64') },
      files: {},
    };
    const fromSnapshot = extractClaimsFromSnapshot(snapshot);
    expect(fromSnapshot?.sub).toBe('google-sub-999');
  });

  it('JWT extraction safely handles garbage bytes', () => {
    expect(extractClaimsFromSecret(Buffer.from('not json'))).toBeNull();
    expect(extractClaimsFromSecret(Buffer.from(JSON.stringify({ id_token: 'not.a.valid.jwt.tokens' })))).toBeNull();
    expect(extractClaimsFromSecret(Buffer.alloc(0))).toBeNull();
  });
});
