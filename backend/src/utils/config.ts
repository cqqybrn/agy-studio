import os from 'node:os';
import path from 'node:path';
import { AppError } from './errors.js';

export interface AppConfig {
  host: string;
  port: number;
  token?: string;
  agyBin?: string;
  dataDir: string;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  ) {
    return true;
  }
  // IPv4 loopback block 127.0.0.0/8
  if (/^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$/.test(normalized)) {
    return true;
  }
  // IPv4-mapped IPv6 loopback
  if (
    normalized === '::ffff:127.0.0.1' ||
    /^::ffff:127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$/.test(normalized)
  ) {
    return true;
  }
  return false;
}

export function resolveDataDir(rawPath?: string): string {
  const dir = rawPath?.trim() || '~/.agy-studio';
  if (dir === '~') {
    return os.homedir();
  }
  if (dir.startsWith('~/') || dir.startsWith('~\\')) {
    return path.join(os.homedir(), dir.slice(2));
  }
  return path.resolve(dir);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const host = env.HOST?.trim() || '127.0.0.1';
  const portRaw = env.PORT?.trim() || '8790';
  const port = parseInt(portRaw, 10);
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new AppError('BAD_REQUEST', `Invalid PORT: "${portRaw}"`);
  }
  const token = env.AGY_STUDIO_TOKEN?.trim() || undefined;
  const agyBin = env.AGY_BIN?.trim() || undefined;
  const dataDir = resolveDataDir(env.DATA_DIR);

  if (!isLoopbackHost(host) && !token) {
    throw new AppError(
      'UNAUTHORIZED',
      `AGY_STUDIO_TOKEN is required when HOST is not a loopback address (current HOST: "${host}")`,
    );
  }

  return {
    host,
    port,
    token,
    agyBin,
    dataDir,
  };
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}
