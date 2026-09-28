import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CredentialStore,
  extractClaimsFromSecret,
  extractClaimsFromSnapshot,
  parseJwtPayload,
} from '../../src/integrations/agy/credential-store.js';
import { MemoryDpapi } from '../../src/integrations/agy/dpapi.js';
import { MemoryWinCred, type WinCredReadResult } from '../../src/integrations/agy/wincred.js';
import type { CredentialSnapshot } from '../../src/services/ports/credential.port.js';
import { AppError } from '../../src/utils/errors.js';

function createFakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = 'fake-sig';
  return `${header}.${payload}.${signature}`;
}

describe('CredentialStore Integration', () => {
  let tempDir: string;
  let keyring: MemoryWinCred;
  let dpapi: MemoryDpapi;
  let store: CredentialStore;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-cred-test-'));
    keyring = new MemoryWinCred();
    dpapi = new MemoryDpapi();
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

  describe('empty and missing credential handling', () => {
    const liveBytes = () =>
      Buffer.from(JSON.stringify({ id_token: createFakeJwt({ sub: 'live-sub' }), token: { refresh_token: 'r' } }));

    function snapshotWith(targets: Record<string, string>, extra?: Partial<CredentialSnapshot>): CredentialSnapshot {
      return { version: 1, createdAt: '', targets, files: {}, ...extra };
    }

    async function expectAppError(p: Promise<unknown>, code: string): Promise<AppError> {
      const err = await p.then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe(code);
      return err as AppError;
    }

    it('isPresent distinguishes missing, empty and populated entries', async () => {
      expect(await store.isPresent()).toBe(false);
      keyring.set('gemini:antigravity', Buffer.alloc(0), 'antigravity');
      expect(await store.isPresent()).toBe(false);
      keyring.set('gemini:antigravity', liveBytes(), 'antigravity');
      expect(await store.isPresent()).toBe(true);
    });

    it('isPresent propagates read errors instead of reporting absent', async () => {
      const failing = new MemoryWinCred();
      failing.read = async () => {
        throw new AppError('INTERNAL', 'read failed');
      };
      const s = new CredentialStore({ dataDir: tempDir, wincred: failing, dpapi });
      await expect(s.isPresent()).rejects.toThrow('read failed');
    });

    it('snapshot throws AGY_NOT_AUTHENTICATED and writes no file when the entry is missing', async () => {
      await expectAppError(store.snapshot('acc-missing'), 'AGY_NOT_AUTHENTICATED');
      expect(store.hasSnapshot('acc-missing')).toBe(false);
      expect(fs.existsSync(path.join(tempDir, 'credentials', 'acc-missing'))).toBe(false);
    });

    it('snapshot throws and keeps the previous snapshot file when the entry is empty', async () => {
      keyring.set('gemini:antigravity', liveBytes(), 'antigravity');
      await store.snapshot('acc-empty');
      const before = await fs.promises.readFile(store.getSnapshotPath('acc-empty'));

      keyring.set('gemini:antigravity', Buffer.alloc(0), 'antigravity');
      const err = await expectAppError(store.snapshot('acc-empty'), 'AGY_NOT_AUTHENTICATED');
      expect(err.details).toMatchObject({ target: 'gemini:antigravity', reason: 'empty' });

      const after = await fs.promises.readFile(store.getSnapshotPath('acc-empty'));
      expect(after.equals(before)).toBe(true);
    });

    it('takeLiveSnapshot throws instead of returning a snapshot with empty targets', async () => {
      keyring.set('gemini:antigravity', Buffer.alloc(0), 'antigravity');
      await expectAppError(store.takeLiveSnapshot(), 'AGY_NOT_AUTHENTICATED');
    });

    it('snapshot records the UserName and restore writes it back', async () => {
      keyring.set('gemini:antigravity', liveBytes(), 'antigravity');
      const snap = await store.snapshot('acc-user');
      expect(snap.targetUserNames).toEqual({ 'gemini:antigravity': 'antigravity' });

      keyring.set('gemini:antigravity', Buffer.from('other'), 'someone-else');
      await store.restore(await store.loadSnapshot('acc-user'));
      expect(keyring.userNameOf('gemini:antigravity')).toBe('antigravity');
      expect(keyring.get('gemini:antigravity')?.equals(liveBytes())).toBe(true);
    });

    it('restore of a legacy snapshot without UserNames derives "antigravity" from the target', async () => {
      await store.restore(snapshotWith({ 'gemini:antigravity': liveBytes().toString('base64') }));
      expect(keyring.userNameOf('gemini:antigravity')).toBe('antigravity');
    });

    it('restore rejects an empty target payload and leaves the live entry untouched', async () => {
      keyring.set('gemini:antigravity', liveBytes(), 'antigravity');
      const err = await expectAppError(store.restore(snapshotWith({ 'gemini:antigravity': '' })), 'INTERNAL');
      expect(err.details).toMatchObject({ reason: 'empty_payload' });
      expect(keyring.get('gemini:antigravity')?.equals(liveBytes())).toBe(true);
    });

    it('restore rejects a snapshot missing a configured target and writes nothing', async () => {
      keyring.set('gemini:antigravity', liveBytes(), 'antigravity');
      const err = await expectAppError(
        store.restore(snapshotWith({ 'other:target': Buffer.from('x').toString('base64') })),
        'INTERNAL',
      );
      expect(err.details).toMatchObject({ reason: 'missing_payload' });
      expect(keyring.get('gemini:antigravity')?.equals(liveBytes())).toBe(true);
      expect(keyring.get('other:target')).toBeUndefined();
    });

    it('restore validates every target before writing any of them', async () => {
      const s = new CredentialStore({
        dataDir: tempDir,
        wincred: keyring,
        dpapi,
        profile: { credentials: { wincredTargetPatterns: ['a:one', 'b:two'], credentialFiles: [] } },
      });
      keyring.set('a:one', Buffer.from('orig-one'), 'one');
      keyring.set('b:two', Buffer.from('orig-two'), 'two');

      await expectAppError(
        s.restore(snapshotWith({ 'a:one': Buffer.from('new-one').toString('base64'), 'b:two': '' })),
        'INTERNAL',
      );
      expect(keyring.get('a:one')?.toString()).toBe('orig-one');
      expect(keyring.get('b:two')?.toString()).toBe('orig-two');
    });

    it('restore fails when the read-back is empty', async () => {
      class EmptyReadBack extends MemoryWinCred {
        override async read(target: string): Promise<WinCredReadResult> {
          const res = await super.read(target);
          return res.status === 'ok' ? { status: 'empty', userName: res.userName, persist: 2, lastWritten: null } : res;
        }
      }
      const s = new CredentialStore({ dataDir: tempDir, wincred: new EmptyReadBack(), dpapi });
      const err = await expectAppError(
        s.restore(snapshotWith({ 'gemini:antigravity': liveBytes().toString('base64') })),
        'INTERNAL',
      );
      expect(err.message).toContain('read back empty');
    });

    it('restore fails when the read-back content differs', async () => {
      class MismatchReadBack extends MemoryWinCred {
        override async read(target: string): Promise<WinCredReadResult> {
          const res = await super.read(target);
          return res.status === 'ok' ? { ...res, data: Buffer.from('tampered') } : res;
        }
      }
      const s = new CredentialStore({ dataDir: tempDir, wincred: new MismatchReadBack(), dpapi });
      const err = await expectAppError(
        s.restore(snapshotWith({ 'gemini:antigravity': liveBytes().toString('base64') })),
        'INTERNAL',
      );
      expect(err.message).toContain('content mismatch');
    });

    it('MemoryWinCred refuses to write an empty blob', async () => {
      await expect(keyring.write('gemini:antigravity', 'antigravity', Buffer.alloc(0))).rejects.toThrow(AppError);
      expect(keyring.get('gemini:antigravity')).toBeUndefined();
    });
  });
});
