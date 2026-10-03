import { execFile } from 'node:child_process';
import { AppError } from './errors.js';

const GOOGLE_AUTH_URL = 'https://oauth2.googleapis.com/token';

export interface CurlResult {
  /** null when curl could not be started (missing binary). */
  code: number | null;
  stdout: string;
  stderr: string;
  spawnFailed?: boolean;
}

export type CurlRunner = (args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<CurlResult>;

export const runCurl: CurlRunner = (args, env, timeoutMs) =>
  new Promise((resolve) => {
    const bin = process.platform === 'win32' ? 'curl.exe' : 'curl';
    execFile(bin, args, { env, timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (!err) return resolve({ code: 0, stdout, stderr });
      const e = err as NodeJS.ErrnoException & { code?: number | string };
      if (e.code === 'ENOENT') return resolve({ code: null, stdout, stderr, spawnFailed: true });
      resolve({ code: typeof e.code === 'number' ? e.code : 1, stdout, stderr: stderr || e.message });
    });
  });

function describeRoute(env: NodeJS.ProcessEnv): string {
  const raw = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (!raw) return '未使用代理（直连）';
  try {
    return `使用代理 ${new URL(raw).host}`;
  } catch {
    return '使用已配置的代理';
  }
}

const CURL_REASONS: Record<number, string> = {
  5: '无法解析代理地址',
  6: 'DNS 解析失败',
  7: '连接被拒绝或无法建立连接',
  28: '连接超时',
  35: 'TLS 握手失败',
  56: '连接被重置',
  60: '证书校验失败（可能被中间网络设备劫持）',
};

/**
 * Checks that the Google OAuth endpoint is reachable the same way agy would reach it
 * (environment proxy variables only, no Windows system proxy). Any HTTP response counts as
 * reachable. Never blocks when curl itself is unavailable.
 */
export async function assertGoogleAuthReachable(
  options: { env?: NodeJS.ProcessEnv; timeoutSec?: number; run?: CurlRunner } = {},
): Promise<void> {
  const env = options.env ?? process.env;
  if (env.AGY_STUDIO_SKIP_NET_CHECK === '1') return;
  const timeoutSec = options.timeoutSec ?? 8;
  const run = options.run ?? runCurl;

  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const result = await run(
    ['-sS', '-o', nullDevice, '-m', String(timeoutSec), '-w', '%{http_code}', GOOGLE_AUTH_URL],
    env,
    (timeoutSec + 3) * 1000,
  );
  if (result.spawnFailed) return;

  const httpCode = Number(result.stdout.trim());
  if (result.code === 0 && httpCode >= 100 && httpCode < 600) return;

  const route = describeRoute(env);
  const reason = (result.code !== null && CURL_REASONS[result.code]) || `curl 退出码 ${result.code}`;
  throw new AppError(
    'AGY_TIMEOUT',
    `无法连接 Google 登录服务（oauth2.googleapis.com）：${reason}。当前${route}。` +
      '请确认网络可以访问 Google；如果需要代理，请开启系统代理（程序会自动识别），或在启动前设置 HTTPS_PROXY 环境变量。',
    {
      retryable: true,
      details: { host: 'oauth2.googleapis.com', curlExitCode: result.code, route },
    },
  );
}
