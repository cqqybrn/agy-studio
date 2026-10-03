import { execFile } from 'node:child_process';
import net from 'node:net';
import type { Logger } from 'pino';
import { logger as defaultLogger } from './logger.js';

/**
 * agy is a Go program: it only honours the HTTPS_PROXY / HTTP_PROXY / NO_PROXY environment
 * variables and ignores the Windows system proxy that browsers use. On machines behind a
 * proxy (VPN clients usually configure the system proxy only) OAuth login and chat requests
 * therefore time out. At startup we derive those variables from the system proxy so every
 * child process we spawn inherits them. Machines without a proxy are left untouched.
 */

const INTERNET_SETTINGS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const LOOPBACK_BYPASS = ['localhost', '127.0.0.1', '::1'];
const PROXY_ENV_NAMES = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const;

export interface SystemProxySettings {
  enabled: boolean;
  httpProxy?: string;
  httpsProxy?: string;
  bypass: string[];
  pacUrl?: string;
}

export type ApplyProxyResult =
  | { status: 'applied'; proxy: string }
  | {
      status: 'skipped';
      reason: 'disabled' | 'unsupported-platform' | 'env-proxy-present' | 'system-proxy-off' | 'unusable' | 'unreachable' | 'read-failed';
    };

export function hasProxyEnv(env: NodeJS.ProcessEnv): boolean {
  return PROXY_ENV_NAMES.some((name) => Boolean(env[name]));
}

/** Parses `reg query` output into a name -> data map. */
export function parseRegQuery(stdout: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s+(\S+)\s+REG_(?:SZ|EXPAND_SZ|DWORD)\s+(.*?)\s*$/.exec(line);
    if (m) values[m[1]] = m[2];
  }
  return values;
}

function toProxyUrl(hostPort: string): string | undefined {
  const raw = hostPort.trim();
  if (!raw) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withScheme);
    // SOCKS-only proxies cannot be expressed to Node's fetch, skip them.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (!url.hostname || !url.port) return undefined;
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

/** Handles both `host:port` and `http=h:p;https=h:p;socks=h:p` (WinINET) formats. */
export function parseProxyServer(raw: string): { httpProxy?: string; httpsProxy?: string } {
  if (!raw.includes('=')) {
    const url = toProxyUrl(raw);
    return url ? { httpProxy: url, httpsProxy: url } : {};
  }
  const result: { httpProxy?: string; httpsProxy?: string } = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const url = toProxyUrl(part.slice(idx + 1));
    if (!url) continue;
    if (key === 'http') result.httpProxy = url;
    else if (key === 'https') result.httpsProxy = url;
  }
  return result;
}

/** WinINET ProxyOverride (`localhost;127.*;*.corp.com;<local>`) -> NO_PROXY entries. */
export function parseProxyOverride(raw: string | undefined): string[] {
  const entries: string[] = [];
  for (const item of (raw ?? '').split(';')) {
    const entry = item.trim();
    if (!entry || entry === '<local>') continue;
    if (entry.startsWith('*.')) entries.push(entry.slice(1));
    else if (!entry.includes('*')) entries.push(entry);
  }
  return entries;
}

export function mergeNoProxy(existing: string | undefined, extra: string[]): string {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of [...(existing ?? '').split(','), ...extra]) {
    const entry = item.trim();
    if (!entry || seen.has(entry.toLowerCase())) continue;
    seen.add(entry.toLowerCase());
    merged.push(entry);
  }
  return merged.join(',');
}

export function settingsFromRegistry(values: Record<string, string>): SystemProxySettings {
  const { httpProxy, httpsProxy } = parseProxyServer(values.ProxyServer ?? '');
  return {
    enabled: Number(values.ProxyEnable) === 1,
    httpProxy,
    httpsProxy,
    bypass: parseProxyOverride(values.ProxyOverride),
    pacUrl: values.AutoConfigURL || undefined,
  };
}

function queryRegistry(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'reg',
      ['query', INTERNET_SETTINGS_KEY],
      { timeout: 3000, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

export function probeTcp(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export interface ApplySystemProxyOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  readSettings?: () => Promise<SystemProxySettings>;
  probe?: (host: string, port: number) => Promise<boolean>;
  logger?: Logger;
}

export async function applySystemProxyToEnv(options: ApplySystemProxyOptions = {}): Promise<ApplyProxyResult> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const log = options.logger ?? defaultLogger;
  const readSettings =
    options.readSettings ?? (async () => settingsFromRegistry(parseRegQuery(await queryRegistry())));
  const probe = options.probe ?? probeTcp;

  const mode = env.AGY_STUDIO_PROXY?.trim().toLowerCase();
  if (mode === 'off' || mode === 'direct' || mode === '0' || mode === 'false') {
    return { status: 'skipped', reason: 'disabled' };
  }
  if (platform !== 'win32') return { status: 'skipped', reason: 'unsupported-platform' };
  // An explicit user setting always wins over auto-detection.
  if (hasProxyEnv(env)) return { status: 'skipped', reason: 'env-proxy-present' };

  let settings: SystemProxySettings;
  try {
    settings = await readSettings();
  } catch (err) {
    log.debug({ err }, 'Could not read Windows proxy settings, assuming direct connection');
    return { status: 'skipped', reason: 'read-failed' };
  }

  if (!settings.enabled) return { status: 'skipped', reason: 'system-proxy-off' };

  const httpsProxy = settings.httpsProxy;
  const httpProxy = settings.httpProxy;
  if (!httpsProxy && !httpProxy) {
    if (settings.pacUrl) {
      log.warn(
        { pacUrl: settings.pacUrl },
        'System proxy uses a PAC script which cannot be resolved automatically; set HTTPS_PROXY manually if login or chat times out',
      );
    }
    return { status: 'skipped', reason: 'unusable' };
  }

  // The registry keeps ProxyEnable=1 after a proxy tool crashes; applying a dead proxy would
  // break a machine that could otherwise connect directly.
  const target = new URL((httpsProxy ?? httpProxy) as string);
  if (!(await probe(target.hostname, Number(target.port)))) {
    log.warn(
      { proxy: target.host },
      'System proxy is enabled but not reachable, falling back to a direct connection',
    );
    return { status: 'skipped', reason: 'unreachable' };
  }

  if (httpsProxy) env.HTTPS_PROXY = httpsProxy;
  if (httpProxy) env.HTTP_PROXY = httpProxy;
  env.NO_PROXY = mergeNoProxy(env.NO_PROXY ?? env.no_proxy, [...LOOPBACK_BYPASS, ...settings.bypass]);

  log.info({ proxy: target.host }, 'Using the Windows system proxy for outbound requests (agy ignores it by default)');
  return { status: 'applied', proxy: target.host };
}
