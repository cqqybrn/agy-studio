import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

/**
 * [quota-probe] 额度接口本机探测（V12）
 *
 * 安全约束：
 * - 凭据只读：只调用 keyring 的 getSecret()，从不写回、删除凭据条目，也不读写 ~/.gemini 下的文件。
 * - OAuth 客户端标识只保存在内存，不缓存到任何文件。
 * - 所有记录先脱敏，再经泄漏自检（已知敏感值 + 正则），全部通过才落盘；自检失败则一个文件都不写。
 */

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const LOAD_CODE_ASSIST_URL =
  'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
export const QUOTA_URL =
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary';

const WINCRED_TARGET = 'gemini:antigravity';
const INVALID_ACCESS_TOKEN = 'invalid-access-token-for-quota-probe';
const INVALID_REFRESH_TOKEN = 'invalid-refresh-token-for-quota-probe';
const REQUEST_TIMEOUT_MS = 15_000;

const USEFUL_RESPONSE_HEADERS = [
  'content-type',
  'date',
  'server',
  'cache-control',
  'vary',
  'www-authenticate',
  'retry-after',
  'x-content-type-options',
];

// ─── 脱敏 ────────────────────────────────────────────────────────────────────

export interface SensitiveValue {
  value: string;
  placeholder: string;
}

export class Redactor {
  private readonly values: SensitiveValue[] = [];

  add(value: string | null | undefined, placeholder: string): void {
    if (!value || value.length < 4) return;
    if (this.values.some((v) => v.value === value)) return;
    this.values.push({ value, placeholder });
    // 长值优先替换，避免短值（如邮箱用户名）先命中长值的一部分
    this.values.sort((a, b) => b.value.length - a.value.length);
  }

  addEmail(email: string | null | undefined): void {
    if (!email) return;
    const at = email.indexOf('@');
    const domain = at >= 0 ? email.slice(at + 1) : '';
    this.add(email, domain ? `<redacted:email>@${domain}` : '<redacted:email>');
    if (at > 0) this.add(email.slice(0, at), '<redacted:email-user>');
  }

  get knownValues(): readonly SensitiveValue[] {
    return this.values;
  }

  redactString(input: string): string {
    let s = input;
    for (const { value, placeholder } of this.values) {
      s = s.split(value).join(placeholder);
    }
    return redactByPattern(s);
  }

  redactValue(value: unknown, key?: string): unknown {
    if (key !== undefined) {
      const byKey = placeholderForKey(key, value);
      if (byKey !== undefined) return byKey;
    }
    if (typeof value === 'string') return this.redactString(value);
    if (typeof value === 'number') {
      const s = String(value);
      if (this.values.some((v) => v.value === s)) return '<redacted:numeric-id>';
      return value;
    }
    if (Array.isArray(value)) return value.map((v) => this.redactValue(v));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.redactValue(v, k);
      }
      return out;
    }
    return value;
  }

  /** 返回泄漏描述（不含泄漏值本身）；空数组表示通过 */
  findLeaks(serialized: string): string[] {
    const leaks: string[] = [];
    for (const { value, placeholder } of this.values) {
      if (serialized.includes(value)) leaks.push(`known value for ${placeholder}`);
    }
    for (const [name, re] of LEAK_PATTERNS) {
      if (new RegExp(re.source, re.flags).test(serialized)) leaks.push(`pattern ${name}`);
    }
    return leaks;
  }
}

const TOKEN_KEYS = new Set(['access_token', 'refresh_token', 'id_token', 'accessToken', 'refreshToken', 'idToken']);
const CLIENT_ID_KEYS = new Set(['client_id', 'clientId']);
const CLIENT_SECRET_KEYS = new Set(['client_secret', 'clientSecret']);

/** 按字段名直接替换；返回 undefined 表示不按字段名处理 */
export function placeholderForKey(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object') {
    // 项目字段可能是对象（{ id, name }），逐字段递归处理即可
    return undefined;
  }
  if (TOKEN_KEYS.has(key)) return `<redacted:${key}>`;
  if (CLIENT_ID_KEYS.has(key)) return '<redacted:client_id>';
  if (CLIENT_SECRET_KEYS.has(key)) return '<redacted:client_secret>';
  if (/project/i.test(key) && typeof value === 'string') return '<redacted:project>';
  if (/(^|_)(sub|gaia_?id|user_?id|account_?id|obfuscated_?id)$/i.test(key)) return '<redacted:account-id>';
  if (/email/i.test(key) && typeof value === 'string') {
    const at = value.indexOf('@');
    return at >= 0 ? `<redacted:email>@${value.slice(at + 1)}` : '<redacted:email>';
  }
  return undefined;
}

const LEAK_PATTERNS: Array<[string, RegExp]> = [
  ['google-access-token', /ya29\.[0-9A-Za-z_\-.]+/g],
  ['google-refresh-token', /1\/\/[0-9A-Za-z_-]{10,}/g],
  ['oauth-client-secret', /GOCSPX-[0-9A-Za-z_-]+/g],
  ['oauth-client-id', /[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com/g],
  ['jwt', /eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}/g],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ['long-numeric-id', /(?<![0-9.])[0-9]{15,}(?![0-9.])/g],
];

export function redactByPattern(input: string): string {
  let s = input;
  s = s.replace(/ya29\.[0-9A-Za-z_\-.]+/g, '<redacted:access_token>');
  s = s.replace(/1\/\/[0-9A-Za-z_-]{10,}/g, '<redacted:refresh_token>');
  s = s.replace(/GOCSPX-[0-9A-Za-z_-]+/g, '<redacted:client_secret>');
  s = s.replace(/[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com/g, '<redacted:client_id>');
  s = s.replace(/eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}/g, '<redacted:jwt>');
  s = s.replace(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '<redacted:email>@$1');
  s = s.replace(/(?<![0-9.])[0-9]{15,}(?![0-9.])/g, '<redacted:numeric-id>');
  return s;
}

// ─── 凭据与 OAuth 客户端（只读、只在内存） ────────────────────────────────────

export interface StoredCredential {
  accessToken: string | null;
  refreshToken: string | null;
  expiry: string | null;
  idToken: string | null;
  schemaKeys: string[];
  tokenKeys: string[];
}

export function parseCredentialBlob(bytes: Buffer): StoredCredential | null {
  let text = bytes.toString('utf-8').replace(/^\uFEFF/, '');
  // eslint-disable-next-line no-control-regex -- strips NUL padding from UTF-16 credential blobs
  if (text.includes('\u0000')) text = bytes.toString('utf16le').replace(/\u0000/g, '');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return null;
  }
  const token = (parsed.token ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    accessToken: str(token.access_token),
    refreshToken: str(token.refresh_token),
    expiry: str(token.expiry),
    idToken: str(parsed.id_token),
    schemaKeys: Object.keys(parsed).sort(),
    tokenKeys: Object.keys(token).sort(),
  };
}

export function decodeJwtClaims(jwt: string | null): Record<string, unknown> | null {
  if (!jwt) return null;
  try {
    const part = jwt.split('.')[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

type LiveCredentialResult =
  | { ok: true; credential: StoredCredential }
  | { ok: false; reason: 'missing' | 'empty' | 'read-error' | 'not-json' };

/**
 * 不能用 @napi-rs/keyring：实测 2.1.0 在 Windows 上仅调用 Entry.withTarget() 就会把条目覆盖为空数据（Persist=3）。
 * 这里只调用 Win32 CredReadW；数据经管道以 base64 传回本进程内存，不打印、不落盘。
 */
const CRED_READ_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class QuotaProbeCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr buffer);
}
"@
$ptr = [IntPtr]::Zero
if (-not [QuotaProbeCred]::CredRead('${WINCRED_TARGET}', 1, 0, [ref]$ptr)) {
  $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  if ($err -eq 1168) { Write-Output 'MISSING' } else { Write-Output "ERROR $err" }
  return
}
try {
  $c = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][QuotaProbeCred+CREDENTIAL])
  $bytes = New-Object byte[] $c.CredentialBlobSize
  if ($c.CredentialBlobSize -gt 0) { [Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $bytes, 0, $c.CredentialBlobSize) }
  Write-Output ("OK " + [Convert]::ToBase64String($bytes))
} finally { [QuotaProbeCred]::CredFree($ptr) }
`;

async function readLiveCredential(): Promise<LiveCredentialResult> {
  if (process.platform !== 'win32') return { ok: false, reason: 'read-error' };
  const encoded = Buffer.from(CRED_READ_PS, 'utf16le').toString('base64');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf-8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const line = (r.stdout ?? '').split(/\r?\n/).map((l) => l.trim()).find((l) => /^(OK|MISSING|ERROR)\b/.test(l));
  if (!line || line.startsWith('ERROR')) return { ok: false, reason: 'read-error' };
  if (line === 'MISSING') return { ok: false, reason: 'missing' };
  const bytes = Buffer.from(line.slice(3).trim(), 'base64');
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  const credential = parseCredentialBlob(bytes);
  return credential ? { ok: true, credential } : { ok: false, reason: 'not-json' };
}

const CREDENTIAL_FAILURE_MESSAGES: Record<Exclude<LiveCredentialResult, { ok: true }>['reason'], string> = {
  missing: `凭据管理器中没有 ${WINCRED_TARGET} 条目（本机未登录 agy）`,
  empty: `${WINCRED_TARGET} 条目存在但数据长度为 0（凭据被清空或被其他程序写成空值，需重新登录 agy）`,
  'read-error': `读取 ${WINCRED_TARGET} 条目时出错`,
  'not-json': `${WINCRED_TARGET} 条目内容不是可解析的 JSON（格式与 V7 实录不符）`,
};

export interface OauthClientCandidates {
  clientId: string;
  /** 按在二进制中首次出现的顺序排列；换 token 时依次尝试，遇到 invalid_client 才换下一个 */
  clientSecrets: string[];
  source: 'env' | 'binary';
  diagnostics: {
    clientIdCandidates: number;
    clientSecretCandidates: number;
    clientIdSelection: 'env' | 'id_token-aud' | 'single-candidate';
  };
}

export interface OauthClient {
  clientId: string;
  clientSecret: string;
}

/**
 * 从 agy 程序文本中找出 OAuth 客户端候选。
 * client_id 取 live 凭据 id_token 的 aud（签发该 refresh token 的客户端）；只有一个候选时直接使用。
 */
export function extractOauthClientFromText(text: string, issuingClientId?: string | null): OauthClientCandidates | null {
  const ids = [...new Set([...text.matchAll(/[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com/g)].map((m) => m[0]))];
  const secrets = [...new Set([...text.matchAll(/GOCSPX-[A-Za-z0-9_-]{28}/g)].map((m) => m[0]))].filter(
    (s) => s.length === 35,
  );
  if (!ids.length || !secrets.length) return null;

  let clientId: string;
  let clientIdSelection: OauthClientCandidates['diagnostics']['clientIdSelection'];
  if (issuingClientId && ids.includes(issuingClientId)) {
    clientId = issuingClientId;
    clientIdSelection = 'id_token-aud';
  } else if (ids.length === 1) {
    clientId = ids[0];
    clientIdSelection = 'single-candidate';
  } else {
    return null;
  }

  return {
    clientId,
    clientSecrets: secrets,
    source: 'binary',
    diagnostics: { clientIdCandidates: ids.length, clientSecretCandidates: secrets.length, clientIdSelection },
  };
}

function resolveOauthClient(agyBin: string | null, issuingClientId: string | null): OauthClientCandidates | null {
  const envId = process.env.AGY_OAUTH_CLIENT_ID;
  const envSecret = process.env.AGY_OAUTH_CLIENT_SECRET;
  if (envId && envSecret) {
    return {
      clientId: envId,
      clientSecrets: [envSecret],
      source: 'env',
      diagnostics: { clientIdCandidates: 1, clientSecretCandidates: 1, clientIdSelection: 'env' },
    };
  }
  if (!agyBin || !fs.existsSync(agyBin)) return null;
  return extractOauthClientFromText(fs.readFileSync(agyBin).toString('latin1'), issuingClientId);
}

function findAgyBinary(override?: string): string | null {
  if (override && fs.existsSync(override)) return path.resolve(override);
  if (process.env.AGY_BIN && fs.existsSync(process.env.AGY_BIN)) return path.resolve(process.env.AGY_BIN);
  const local = path.join(process.env.LOCALAPPDATA ?? '', 'agy', 'bin', 'agy.exe');
  if (fs.existsSync(local)) return local;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['agy'], { encoding: 'utf-8' });
  const first = probe.stdout?.split(/\r?\n/)[0]?.trim();
  return first && fs.existsSync(first) ? path.resolve(first) : null;
}

function readAgyVersion(bin: string): string | null {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf-8' });
  const m = `${r.stdout ?? ''}${r.stderr ?? ''}`.match(/\b(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\b/);
  return m ? m[1] : null;
}

// ─── HTTP 录制 ────────────────────────────────────────────────────────────────

export interface HttpRecord {
  name: string;
  description: string;
  startedAt: string;
  durationMs: number;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
  };
  response: {
    status: number | null;
    statusText: string | null;
    headerNames: string[];
    headers: Record<string, string>;
    bodyIsJson: boolean;
    body: unknown;
  } | null;
  networkError: string | null;
}

interface CallSpec {
  name: string;
  description: string;
  method: 'POST';
  url: string;
  headers: Record<string, string>;
  body: string;
  /** 用于记录的请求体（结构化形式，后续统一脱敏） */
  bodyForRecord: unknown;
}

async function performCall(spec: CallSpec): Promise<{ record: HttpRecord; json: unknown }> {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  let record: HttpRecord;
  let json: unknown = null;
  try {
    const res = await fetch(spec.url, {
      method: spec.method,
      headers: spec.headers,
      body: spec.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    const durationMs = Math.round(performance.now() - t0);
    let bodyIsJson = false;
    try {
      json = text ? JSON.parse(text) : null;
      bodyIsJson = true;
    } catch {
      json = null;
    }
    const headerNames: string[] = [];
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headerNames.push(key);
      if (USEFUL_RESPONSE_HEADERS.includes(key)) headers[key] = value;
    });
    record = {
      name: spec.name,
      description: spec.description,
      startedAt,
      durationMs,
      request: { method: spec.method, url: spec.url, headers: { ...spec.headers }, body: spec.bodyForRecord },
      response: {
        status: res.status,
        statusText: res.statusText || null,
        headerNames: headerNames.sort(),
        headers,
        bodyIsJson,
        body: bodyIsJson ? json : text.slice(0, 4000),
      },
      networkError: null,
    };
  } catch (err) {
    record = {
      name: spec.name,
      description: spec.description,
      startedAt,
      durationMs: Math.round(performance.now() - t0),
      request: { method: spec.method, url: spec.url, headers: { ...spec.headers }, body: spec.bodyForRecord },
      response: null,
      networkError: String((err as Error)?.message ?? err),
    };
  }
  return { record, json };
}

function cloudCodeCall(
  name: string,
  description: string,
  url: string,
  accessToken: string,
  userAgent: string,
  body: unknown,
): CallSpec {
  return {
    name,
    description,
    method: 'POST',
    url,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
    },
    body: JSON.stringify(body ?? {}),
    bodyForRecord: body ?? {},
  };
}

function tokenRefreshCall(name: string, description: string, client: OauthClient, refreshToken: string): CallSpec {
  const form = {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  };
  return {
    name,
    description,
    method: 'POST',
    url: TOKEN_URL,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    bodyForRecord: { encoding: 'application/x-www-form-urlencoded', fields: form },
  };
}

// ─── 结构描述（字段名 + 类型，便于 1.17 对照） ─────────────────────────────────

export function describeShape(value: unknown): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return ['<empty>'];
    return [describeShape(value[0])];
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = describeShape(v);
    return out;
  }
  return typeof value;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
[quota-probe] 额度接口本机探测工具（阶段 0 探测清单 V12）
用本机当前登录的 agy 账号（Windows 凭据管理器 gemini:antigravity，只读）换取 access token，
调用 loadCodeAssist 与 retrieveUserQuotaSummary，并录制两个失败场景（无效 access token、无效 refresh token）。
所有记录在内存中脱敏并通过泄漏自检后才写盘；OAuth 客户端标识只在内存中使用。

用法说明:
  npx tsx tools/discover/quota-probe.ts [选项]

选项:
  --out-dir <dir>  写入脱敏 fixtures 的目录（例如 fixtures/agy/quota）；不指定时只在终端打印脱敏摘要
  --bin <path>     指定 agy 可执行程序路径（默认自动查找；用于读取版本与 OAuth 客户端）
  --scan <paths>   不录制，改为用内存中的真实敏感值（token、client 标识、邮箱及用户名、sub、姓名、project、
                   用户目录）扫描逗号分隔的文件或目录，只输出命中次数（会换一次 token、调一次 loadCodeAssist）
  -h, --help       显示帮助信息

环境变量:
  AGY_OAUTH_CLIENT_ID / AGY_OAUTH_CLIENT_SECRET  显式提供 OAuth 客户端（否则从 agy 程序中读取）
  HTTPS_PROXY / HTTP_PROXY                        存在时自动以 NODE_USE_ENV_PROXY=1 重新启动，使 fetch 走代理

示例:
  npx tsx tools/discover/quota-probe.ts
  npx tsx tools/discover/quota-probe.ts --out-dir fixtures/agy/quota
`);
}

function parseCliArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

function hasEnvProxy(): boolean {
  return Boolean(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy);
}

/** Node 24 的 fetch 默认不读取 HTTPS_PROXY；需要时带 NODE_USE_ENV_PROXY=1 重启自身 */
function reexecWithEnvProxyIfNeeded(): boolean {
  if (!hasEnvProxy() || process.env.NODE_USE_ENV_PROXY === '1') return false;
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status ?? 1);
}

function listFiles(target: string): string[] {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) return [];
  if (fs.statSync(resolved).isFile()) return [resolved];
  return fs.readdirSync(resolved, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.join(d.parentPath, d.name));
}

/** 用本次内存中的真实敏感值（含 URL 编码形式）扫描文件，只输出每类命中次数，不输出值 */
function scanFilesForKnownValues(targets: string[], redactor: Redactor): void {
  const needles: Array<{ value: string; placeholder: string }> = [];
  for (const { value, placeholder } of redactor.knownValues) {
    needles.push({ value, placeholder });
    const encoded = encodeURIComponent(value);
    if (encoded !== value) needles.push({ value: encoded, placeholder: `${placeholder}（URL 编码）` });
  }
  const files = targets.flatMap(listFiles);
  let total = 0;
  console.log(`\n[scan] 用 ${needles.length} 个内存中的真实敏感值扫描 ${files.length} 个文件：`);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const { value, placeholder } of needles) {
      const hits = text.split(value).length - 1;
      if (hits > 0) {
        total += hits;
        console.log(`  命中 ${hits} 次 · ${placeholder} · ${redactor.redactString(path.relative(process.cwd(), file))}`);
      }
    }
  }
  const categories = [...new Set(redactor.knownValues.map((v) => v.placeholder))].sort();
  console.log(`[scan] 覆盖的敏感值类别：${categories.join(', ')}`);
  console.log(total === 0 ? '[scan] 结果：0 处残留' : `[scan] 结果：${total} 处残留`);
}

function fail(message: string): never {
  console.error(`[quota-probe] 停止：${message}`);
  process.exit(1);
}

function summarizeRecord(r: HttpRecord): string {
  if (!r.response) return `${r.name}: 网络错误（${r.networkError}）`;
  return `${r.name}: HTTP ${r.response.status} · ${r.durationMs} ms`;
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return;
  }
  reexecWithEnvProxyIfNeeded();

  const flags = parseCliArgs(argv);
  const redactor = new Redactor();
  const home = os.homedir();
  const username = os.userInfo().username;

  console.log('[quota-probe] 1/6 定位 agy 程序与版本...');
  const agyBin = findAgyBinary(flags.bin);
  const agyVersion = agyBin ? readAgyVersion(agyBin) : null;
  console.log(`  agy 版本: ${agyVersion ?? '未知'}`);

  console.log('[quota-probe] 2/6 只读读取 live 凭据（gemini:antigravity）...');
  const live = await readLiveCredential();
  if (!live.ok) fail(`${CREDENTIAL_FAILURE_MESSAGES[live.reason]}，未发出任何请求。`);
  const cred = live.credential;
  if (!cred.refreshToken) fail('凭据中没有 token.refresh_token，未发出任何请求。');
  const claims = decodeJwtClaims(cred.idToken);
  redactor.add(cred.accessToken, '<redacted:access_token>');
  redactor.add(cred.refreshToken, '<redacted:refresh_token>');
  redactor.add(cred.idToken, '<redacted:id_token>');
  redactor.addEmail(typeof claims?.email === 'string' ? claims.email : null);
  redactor.add(typeof claims?.sub === 'string' ? claims.sub : null, '<redacted:account-id>');
  redactor.add(typeof claims?.name === 'string' ? claims.name : null, '<redacted:name>');
  redactor.add(typeof claims?.given_name === 'string' ? claims.given_name : null, '<redacted:name>');
  redactor.add(home, '%USERPROFILE%');
  if (username.length >= 4) redactor.add(username, '%USERNAME%');
  const storedExpiryMs = cred.expiry ? Date.parse(cred.expiry) : NaN;
  console.log(`  凭据字段: ${cred.schemaKeys.join(', ')}；token 字段: ${cred.tokenKeys.join(', ')}`);

  console.log('[quota-probe] 3/6 获取 OAuth 客户端（只在内存中使用）...');
  const issuingClientId =
    typeof claims?.aud === 'string' ? claims.aud : typeof claims?.azp === 'string' ? claims.azp : null;
  const candidates = resolveOauthClient(agyBin, issuingClientId);
  if (!candidates) {
    fail('无法获取 OAuth 客户端（未设置环境变量，且无法在 agy 程序中唯一确定与 id_token.aud 一致的 client_id），未发出任何请求。');
  }
  redactor.add(candidates.clientId, '<redacted:client_id>');
  for (const s of candidates.clientSecrets) redactor.add(s, '<redacted:client_secret>');
  console.log(
    `  来源: ${candidates.source}；client_id 选择方式 ${candidates.diagnostics.clientIdSelection}；候选 client_id ${candidates.diagnostics.clientIdCandidates} 个，client_secret ${candidates.diagnostics.clientSecretCandidates} 个`,
  );

  const userAgent = `antigravity/${agyVersion ?? '0.0.0'} ${process.platform}/${process.arch}`;
  const records: HttpRecord[] = [];

  console.log('[quota-probe] 4/6 用 refresh token 换取 access token...');
  let client: OauthClient | null = null;
  let refresh: { record: HttpRecord; json: unknown } | null = null;
  let secretAttempts = 0;
  let acceptedSecretIndex: number | null = null;
  for (const [index, clientSecret] of candidates.clientSecrets.slice(0, 2).entries()) {
    secretAttempts++;
    const attemptClient = { clientId: candidates.clientId, clientSecret };
    const attempt = await performCall(
      tokenRefreshCall('token-refresh', '用 live 凭据中的 refresh_token 换取 access_token', attemptClient, cred.refreshToken),
    );
    const errorCode = (attempt.json as { error?: unknown } | null)?.error;
    if (errorCode === 'invalid_client' && index + 1 < Math.min(2, candidates.clientSecrets.length)) {
      attempt.record.name = 'token-refresh-wrong-client-secret';
      attempt.record.description = '二进制中另一个 client_secret 候选与 client_id 不匹配时的响应（invalid_client）';
      records.push(attempt.record);
      console.log(`  ${summarizeRecord(attempt.record)}（secret 候选 #${index} 不匹配，尝试下一个）`);
      continue;
    }
    refresh = attempt;
    client = attemptClient;
    acceptedSecretIndex = index;
    break;
  }
  const refreshJson = refresh?.json as Record<string, unknown> | null;
  const accessToken = typeof refreshJson?.access_token === 'string' ? refreshJson.access_token : null;
  redactor.add(accessToken, '<redacted:access_token>');
  if (typeof refreshJson?.id_token === 'string') redactor.add(refreshJson.id_token, '<redacted:id_token>');
  if (refresh) {
    records.push(refresh.record);
    console.log(`  ${summarizeRecord(refresh.record)}`);
  }
  if (!refresh || !client || !accessToken) {
    fail(`换取 access token 失败（HTTP ${refresh?.record.response?.status ?? '无响应'}），未继续调用额度接口，也未写任何文件。`);
  }

  console.log('[quota-probe] 5/6 调用 loadCodeAssist 与 retrieveUserQuotaSummary...');
  const lca = await performCall(
    cloudCodeCall(
      'load-code-assist',
      'loadCodeAssist：获取套餐/tier 与 cloudaicompanionProject（agy-auto 用其结果作为额度请求的 project）',
      LOAD_CODE_ASSIST_URL,
      accessToken,
      userAgent,
      { metadata: { ideType: 'ANTIGRAVITY' } },
    ),
  );
  records.push(lca.record);
  console.log(`  ${summarizeRecord(lca.record)}`);
  const lcaJson = lca.json as Record<string, unknown> | null;
  const projectRaw = lcaJson?.cloudaicompanionProject;
  const project =
    typeof projectRaw === 'string'
      ? projectRaw
      : projectRaw && typeof projectRaw === 'object' && typeof (projectRaw as { id?: unknown }).id === 'string'
        ? ((projectRaw as { id: string }).id)
        : null;
  redactor.add(project, '<redacted:project>');

  if (flags.scan) {
    scanFilesForKnownValues(flags.scan.split(','), redactor);
    return;
  }

  const quotaBodies: Array<[string, string, unknown]> = [];
  if (project) {
    quotaBodies.push(['quota-summary', 'retrieveUserQuotaSummary，请求体带 loadCodeAssist 返回的 project', { project }]);
    quotaBodies.push(['quota-summary-empty-body', 'retrieveUserQuotaSummary，空请求体 {}（agy-auto 的回退写法）', {}]);
  } else {
    quotaBodies.push(['quota-summary', 'retrieveUserQuotaSummary，空请求体 {}（loadCodeAssist 未返回 project）', {}]);
  }
  const quotaJsons: Record<string, unknown> = {};
  for (const [name, desc, body] of quotaBodies) {
    const r = await performCall(cloudCodeCall(name, desc, QUOTA_URL, accessToken, userAgent, body));
    records.push(r.record);
    quotaJsons[name] = r.json;
    console.log(`  ${summarizeRecord(r.record)}`);
  }

  console.log('[quota-probe] 6/6 录制失败场景...');
  const unauthorized = await performCall(
    cloudCodeCall(
      'quota-unauthorized',
      'retrieveUserQuotaSummary，使用明显无效的 access token（模拟 token 失效）',
      QUOTA_URL,
      INVALID_ACCESS_TOKEN,
      userAgent,
      project ? { project } : {},
    ),
  );
  records.push(unauthorized.record);
  console.log(`  ${summarizeRecord(unauthorized.record)}`);
  const invalidGrant = await performCall(
    tokenRefreshCall('token-refresh-invalid-grant', '用明显无效的 refresh_token 换取 access_token（模拟 refresh token 被吊销）', client, INVALID_REFRESH_TOKEN),
  );
  records.push(invalidGrant.record);
  console.log(`  ${summarizeRecord(invalidGrant.record)}`);

  // ─── 脱敏 + 自检 ───
  const redactedRecords = records.map((r) => redactor.redactValue(r) as HttpRecord);
  const mainQuota = quotaJsons['quota-summary'];
  const meta = {
    probedAt: new Date().toISOString(),
    tool: 'tools/discover/quota-probe.ts',
    agyVersion,
    agyBinary: agyBin ? redactor.redactString(agyBin) : null,
    nodeVersion: process.version,
    viaEnvProxy: hasEnvProxy(),
    userAgentSent: userAgent,
    userAgentNote: 'User-Agent 格式照 agy-auto（antigravity/<版本> <platform>/<arch>），版本号取本机 agy --version',
    credential: {
      source: `Windows 凭据管理器 ${WINCRED_TARGET}（Win32 CredReadW，只读；不使用 @napi-rs/keyring，因其 Entry.withTarget() 会覆盖条目）`,
      schemaKeys: cred.schemaKeys,
      tokenKeys: cred.tokenKeys,
      storedAccessTokenValidForMoreThan60s: Number.isFinite(storedExpiryMs) ? storedExpiryMs - Date.now() > 60_000 : null,
      idTokenClaimKeys: claims ? Object.keys(claims).sort() : [],
    },
    oauthClient: {
      source:
        candidates.source === 'env'
          ? 'AGY_OAUTH_CLIENT_ID / AGY_OAUTH_CLIENT_SECRET 环境变量'
          : 'agy 程序二进制内的字符串（latin1 扫描 *.apps.googleusercontent.com 与 GOCSPX-*；client_id 取与 live id_token.aud 相同者，secret 按首次出现顺序逐个尝试）',
      ...candidates.diagnostics,
      secretAttempts,
      acceptedSecretIndex,
      cachedToDisk: false,
    },
    endpoints: { token: TOKEN_URL, loadCodeAssist: LOAD_CODE_ASSIST_URL, quotaSummary: QUOTA_URL },
    loadCodeAssistReturnedProject: Boolean(project),
    calls: redactedRecords.map((r) => ({
      name: r.name,
      file: `${r.name}.json`,
      status: r.response?.status ?? null,
      durationMs: r.durationMs,
      networkError: r.networkError,
    })),
    shapes: {
      tokenRefreshResponse: describeShape(refreshJson),
      loadCodeAssistResponse: describeShape(lcaJson),
      quotaSummaryResponse: describeShape(mainQuota),
      unauthorizedResponse: describeShape(unauthorized.json),
      invalidGrantResponse: describeShape(invalidGrant.json),
    },
    redaction: {
      rules: [
        '按字段名替换：access_token / refresh_token / id_token / client_id / client_secret / *project* / *email* / sub 等',
        '按已知值替换：本次读取的 token、client 标识、邮箱（保留域名）与邮箱用户名、账号 sub、姓名、project、用户目录与用户名',
        '按正则替换：ya29.*、1//*、GOCSPX-*、*.apps.googleusercontent.com、JWT、邮箱、15 位以上纯数字',
      ],
      leakCheck: 'passed',
    },
  };
  const outputs: Record<string, unknown> = { 'probe-meta.json': redactor.redactValue(meta) };
  for (const r of redactedRecords) outputs[`${r.name}.json`] = r;

  const serializedAll = Object.values(outputs).map((o) => JSON.stringify(o)).join('\n');
  const leaks = redactor.findLeaks(serializedAll);
  if (leaks.length) fail(`脱敏自检未通过（${[...new Set(leaks)].join('; ')}），未写任何文件。`);

  if (flags['out-dir']) {
    const outDir = path.resolve(flags['out-dir']);
    fs.mkdirSync(outDir, { recursive: true });
    for (const [file, content] of Object.entries(outputs)) {
      fs.writeFileSync(path.join(outDir, file), JSON.stringify(content, null, 2) + '\n', 'utf-8');
    }
    console.log(`\n[成功] 已写入 ${Object.keys(outputs).length} 个脱敏文件至: ${redactor.redactString(outDir)}`);
  } else {
    console.log('\n[提示] 未指定 --out-dir，只打印脱敏后的额度响应结构：');
    console.log(JSON.stringify(describeShape(mainQuota), null, 2));
  }
}

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('quota-probe.ts') ||
  process.argv[1].endsWith('quota-probe.js')
);

if (isDirectRun) {
  runCli().catch((err) => {
    console.error(`[quota-probe] 异常：${new Redactor().redactString(String((err as Error)?.message ?? err))}`);
    process.exit(1);
  });
}
