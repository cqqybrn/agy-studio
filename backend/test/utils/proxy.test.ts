import { describe, expect, it, vi } from 'vitest';
import {
  applySystemProxyToEnv,
  mergeNoProxy,
  parseProxyOverride,
  parseProxyServer,
  parseRegQuery,
  settingsFromRegistry,
  type SystemProxySettings,
} from '../../src/utils/proxy.js';

const quietLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
} as never;

const enabledSettings = (over: Partial<SystemProxySettings> = {}): SystemProxySettings => ({
  enabled: true,
  httpProxy: 'http://127.0.0.1:10809',
  httpsProxy: 'http://127.0.0.1:10809',
  bypass: [],
  ...over,
});

describe('utils/proxy parsing', () => {
  it('parses reg query output', () => {
    const out = [
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '    ProxyEnable    REG_DWORD    0x1',
      '    ProxyServer    REG_SZ    127.0.0.1:10809',
      '    ProxyOverride    REG_SZ    localhost;127.*;<local>',
      '',
    ].join('\r\n');
    expect(parseRegQuery(out)).toEqual({
      ProxyEnable: '0x1',
      ProxyServer: '127.0.0.1:10809',
      ProxyOverride: 'localhost;127.*;<local>',
    });
  });

  it('handles the single host:port form for all protocols', () => {
    expect(parseProxyServer('127.0.0.1:10809')).toEqual({
      httpProxy: 'http://127.0.0.1:10809',
      httpsProxy: 'http://127.0.0.1:10809',
    });
  });

  it('handles the per-protocol form and ignores socks', () => {
    expect(parseProxyServer('http=10.0.0.1:8080;https=10.0.0.2:8443;socks=10.0.0.3:1080')).toEqual({
      httpProxy: 'http://10.0.0.1:8080',
      httpsProxy: 'http://10.0.0.2:8443',
    });
  });

  it('does not invent an https proxy when only http= is configured', () => {
    expect(parseProxyServer('http=10.0.0.1:8080')).toEqual({ httpProxy: 'http://10.0.0.1:8080' });
  });

  it('rejects socks-only and malformed values', () => {
    expect(parseProxyServer('socks5://127.0.0.1:1080')).toEqual({});
    expect(parseProxyServer('socks=127.0.0.1:1080')).toEqual({});
    expect(parseProxyServer('not a proxy')).toEqual({});
    expect(parseProxyServer('')).toEqual({});
  });

  it('converts ProxyOverride to NO_PROXY entries', () => {
    expect(parseProxyOverride('localhost;127.*;*.corp.com;intranet;<local>')).toEqual([
      'localhost',
      '.corp.com',
      'intranet',
    ]);
    expect(parseProxyOverride(undefined)).toEqual([]);
  });

  it('merges NO_PROXY without duplicates', () => {
    expect(mergeNoProxy('localhost, .local', ['LOCALHOST', '127.0.0.1', '.local'])).toBe(
      'localhost,.local,127.0.0.1',
    );
  });

  it('builds settings from registry values', () => {
    expect(
      settingsFromRegistry({ ProxyEnable: '0x0', ProxyServer: '127.0.0.1:10809', AutoConfigURL: 'http://pac/x.pac' }),
    ).toMatchObject({ enabled: false, httpsProxy: 'http://127.0.0.1:10809', pacUrl: 'http://pac/x.pac' });
  });
});

describe('applySystemProxyToEnv', () => {
  const run = (env: NodeJS.ProcessEnv, extra: Parameters<typeof applySystemProxyToEnv>[0] = {}) =>
    applySystemProxyToEnv({
      env,
      platform: 'win32',
      logger: quietLogger,
      readSettings: async () => enabledSettings(),
      probe: async () => true,
      ...extra,
    });

  it('applies the system proxy and always keeps loopback out of the proxy', async () => {
    const env: NodeJS.ProcessEnv = {};
    const res = await run(env, { readSettings: async () => enabledSettings({ bypass: ['.corp.com'] }) });
    expect(res).toEqual({ status: 'applied', proxy: '127.0.0.1:10809' });
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:10809');
    expect(env.HTTP_PROXY).toBe('http://127.0.0.1:10809');
    expect(env.NO_PROXY).toBe('localhost,127.0.0.1,::1,.corp.com');
  });

  it('keeps an existing NO_PROXY and appends to it', async () => {
    const env: NodeJS.ProcessEnv = { NO_PROXY: 'internal.example' };
    await run(env);
    expect(env.NO_PROXY).toBe('internal.example,localhost,127.0.0.1,::1');
  });

  it('never overrides a proxy the user already configured', async () => {
    const env: NodeJS.ProcessEnv = { HTTPS_PROXY: 'http://corp:3128' };
    const readSettings = vi.fn(async () => enabledSettings());
    expect(await run(env, { readSettings })).toEqual({ status: 'skipped', reason: 'env-proxy-present' });
    expect(env.HTTPS_PROXY).toBe('http://corp:3128');
    expect(readSettings).not.toHaveBeenCalled();
  });

  it('leaves direct-connection machines untouched', async () => {
    const env: NodeJS.ProcessEnv = {};
    const res = await run(env, { readSettings: async () => enabledSettings({ enabled: false }) });
    expect(res).toEqual({ status: 'skipped', reason: 'system-proxy-off' });
    expect(env).toEqual({});
  });

  it('falls back to direct when the registry cannot be read', async () => {
    const env: NodeJS.ProcessEnv = {};
    const res = await run(env, {
      readSettings: async () => {
        throw new Error('reg missing');
      },
    });
    expect(res).toEqual({ status: 'skipped', reason: 'read-failed' });
    expect(env).toEqual({});
  });

  it('ignores a stale system proxy whose port is not listening', async () => {
    const env: NodeJS.ProcessEnv = {};
    const res = await run(env, { probe: async () => false });
    expect(res).toEqual({ status: 'skipped', reason: 'unreachable' });
    expect(env).toEqual({});
  });

  it('skips PAC-only and socks-only configurations', async () => {
    const env: NodeJS.ProcessEnv = {};
    const res = await run(env, {
      readSettings: async () =>
        enabledSettings({ httpProxy: undefined, httpsProxy: undefined, pacUrl: 'http://pac/x.pac' }),
    });
    expect(res).toEqual({ status: 'skipped', reason: 'unusable' });
    expect(env).toEqual({});
  });

  it('can be turned off with AGY_STUDIO_PROXY=off', async () => {
    const env: NodeJS.ProcessEnv = { AGY_STUDIO_PROXY: 'off' };
    expect(await run(env)).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(env.HTTPS_PROXY).toBeUndefined();
  });

  it('does nothing outside Windows', async () => {
    const env: NodeJS.ProcessEnv = {};
    expect(await run(env, { platform: 'linux' })).toEqual({ status: 'skipped', reason: 'unsupported-platform' });
  });
});
