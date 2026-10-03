import { describe, expect, it, vi } from 'vitest';
import { assertGoogleAuthReachable, type CurlRunner } from '../../src/utils/connectivity.js';
import { AppError } from '../../src/utils/errors.js';

const ok = (httpCode: string): CurlRunner => async () => ({ code: 0, stdout: httpCode, stderr: '' });
const failed = (code: number): CurlRunner => async () => ({ code, stdout: '000', stderr: 'curl failed' });

describe('assertGoogleAuthReachable', () => {
  it('passes on any HTTP response, even an error status', async () => {
    await expect(assertGoogleAuthReachable({ env: {}, run: ok('404') })).resolves.toBeUndefined();
    await expect(assertGoogleAuthReachable({ env: {}, run: ok('200') })).resolves.toBeUndefined();
  });

  it('reports a direct connection timeout', async () => {
    const err = await assertGoogleAuthReachable({ env: {}, run: failed(28) }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('AGY_TIMEOUT');
    expect(err.retryable).toBe(true);
    expect(err.message).toContain('连接超时');
    expect(err.message).toContain('未使用代理（直连）');
  });

  it('mentions the proxy host in use, without leaking credentials', async () => {
    const env = { HTTPS_PROXY: 'http://user:secret@127.0.0.1:10809' };
    const err = await assertGoogleAuthReachable({ env, run: failed(7) }).catch((e) => e);
    expect(err.message).toContain('127.0.0.1:10809');
    expect(err.message).not.toContain('secret');
    expect(JSON.stringify(err.details)).not.toContain('secret');
  });

  it('never blocks when curl is not available', async () => {
    const run: CurlRunner = async () => ({ code: null, stdout: '', stderr: '', spawnFailed: true });
    await expect(assertGoogleAuthReachable({ env: {}, run })).resolves.toBeUndefined();
  });

  it('can be skipped with AGY_STUDIO_SKIP_NET_CHECK=1', async () => {
    const run = vi.fn(failed(28));
    await expect(assertGoogleAuthReachable({ env: { AGY_STUDIO_SKIP_NET_CHECK: '1' }, run })).resolves.toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });

  it('passes the effective env to curl so it behaves like agy', async () => {
    const run = vi.fn(ok('404'));
    const env = { HTTPS_PROXY: 'http://127.0.0.1:10809' };
    await assertGoogleAuthReachable({ env, run });
    expect(run.mock.calls[0][1]).toBe(env);
  });
});
