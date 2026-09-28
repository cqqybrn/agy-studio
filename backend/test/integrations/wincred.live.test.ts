import { randomBytes } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { WindowsCredentialManager, CRED_PERSIST_LOCAL_MACHINE } from '../../src/integrations/agy/wincred.js';

// Touches the real Windows Credential Manager, so it only runs when explicitly enabled:
//   $env:AGY_STUDIO_WINCRED_LIVE_TEST = '1'; npm run test -w backend -- wincred.live
// It only ever uses a throwaway "agy-studio-test:<random>" target, never gemini:antigravity.
const enabled = process.platform === 'win32' && process.env.AGY_STUDIO_WINCRED_LIVE_TEST === '1';

const TEST_PREFIX = 'agy-studio-test:';

describe.skipIf(!enabled)('WindowsCredentialManager against the real credential manager', () => {
  const target = `${TEST_PREFIX}${randomBytes(8).toString('hex')}`;
  const mgr = new WindowsCredentialManager();

  afterAll(async () => {
    if (!target.startsWith(TEST_PREFIX)) return;
    try {
      await mgr.delete(target);
    } catch {
      // best-effort cleanup
    }
  });

  it('writes, reads, overwrites and deletes a throwaway generic entry', { timeout: 60_000 }, async () => {
    expect(target.startsWith(TEST_PREFIX)).toBe(true);
    expect(target).not.toBe('gemini:antigravity');

    expect(await mgr.read(target)).toEqual({ status: 'missing' });

    const first = Buffer.from(JSON.stringify({ auth_method: 'test', token: { refresh_token: randomBytes(24).toString('hex') } }));
    await mgr.write(target, 'antigravity', first);
    const r1 = await mgr.read(target);
    expect(r1.status).toBe('ok');
    if (r1.status !== 'ok') throw new Error('unreachable');
    expect(r1.data.equals(first)).toBe(true);
    expect(r1.userName).toBe('antigravity');
    expect(r1.persist).toBe(CRED_PERSIST_LOCAL_MACHINE);
    expect(r1.lastWritten).not.toBeNull();

    const second = Buffer.from(randomBytes(1600).toString('base64').slice(0, 1600));
    await mgr.write(target, 'antigravity', second);
    const r2 = await mgr.read(target);
    expect(r2.status === 'ok' && r2.data.equals(second)).toBe(true);

    await expect(mgr.write(target, 'antigravity', Buffer.alloc(0))).rejects.toThrow();
    const r3 = await mgr.read(target);
    expect(r3.status === 'ok' && r3.data.equals(second)).toBe(true);

    expect(await mgr.delete(target)).toBe(true);
    expect(await mgr.read(target)).toEqual({ status: 'missing' });
    expect(await mgr.delete(target)).toBe(false);
  });
});
