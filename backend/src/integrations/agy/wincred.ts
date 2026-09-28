import { spawn } from 'node:child_process';
import { AppError } from '../../utils/errors.js';
import { killTree } from '../../utils/proc-tree.js';

export const CRED_PERSIST_LOCAL_MACHINE = 2;

export interface WinCredEntryMeta {
  userName: string | null;
  persist: number | null;
  /** ISO timestamp of the entry's LastWritten FILETIME */
  lastWritten: string | null;
}

export type WinCredReadResult =
  | { status: 'missing' }
  | ({ status: 'empty' } & WinCredEntryMeta)
  | ({ status: 'ok'; data: Buffer } & WinCredEntryMeta);

/**
 * Generic (CRED_TYPE_GENERIC) entries in the Windows Credential Manager.
 * Writes always use Persist = CRED_PERSIST_LOCAL_MACHINE.
 */
export interface WinCredPort {
  read(target: string): Promise<WinCredReadResult>;
  write(target: string, userName: string, data: Buffer): Promise<void>;
  /** Returns false when the entry did not exist. */
  delete(target: string): Promise<boolean>;
}

export type WinCredRequest =
  | { op: 'read'; target: string }
  | { op: 'write'; target: string; userName: string; data: Buffer }
  | { op: 'delete'; target: string };

export interface PowerShellInvocation {
  command: string;
  args: string[];
  /** Everything request-specific (target, user name, secret) travels here, never in args. */
  stdin: string;
}

export interface PowerShellResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type PowerShellRunner = (invocation: PowerShellInvocation, timeoutMs: number) => Promise<PowerShellResult>;

export interface WindowsCredentialManagerOptions {
  powershellPath?: string;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  runner?: PowerShellRunner;
}

// Uses CredReadW / CredWriteW / CredDeleteW directly. Do not replace with @napi-rs/keyring:
// its Entry.withTarget() overwrites the existing entry with an empty blob (Persist=3) on Windows.
const WINCRED_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $req = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AgyStudioWinCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWrite(ref CREDENTIAL cred, int flags);
  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDelete(string target, int type, int flags);
  [DllImport("advapi32.dll")]
  private static extern void CredFree(IntPtr buffer);

  public static int Read(string target, out byte[] data, out string userName, out int persist, out long lastWritten) {
    data = new byte[0]; userName = null; persist = 0; lastWritten = 0;
    IntPtr ptr;
    if (!CredRead(target, 1, 0, out ptr)) return Marshal.GetLastWin32Error();
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
      data = new byte[c.CredentialBlobSize];
      if (c.CredentialBlobSize > 0) Marshal.Copy(c.CredentialBlob, data, 0, c.CredentialBlobSize);
      userName = c.UserName; persist = c.Persist; lastWritten = c.LastWritten;
      return 0;
    } finally { CredFree(ptr); }
  }

  public static int Write(string target, string userName, byte[] data) {
    if (data == null || data.Length == 0) return 87;
    IntPtr blob = Marshal.AllocHGlobal(data.Length);
    try {
      Marshal.Copy(data, 0, blob, data.Length);
      CREDENTIAL c = new CREDENTIAL();
      c.Type = 1; c.TargetName = target; c.UserName = userName;
      c.CredentialBlobSize = data.Length; c.CredentialBlob = blob; c.Persist = 2;
      if (!CredWrite(ref c, 0)) return Marshal.GetLastWin32Error();
      return 0;
    } finally {
      Marshal.Copy(new byte[data.Length], 0, blob, data.Length);
      Marshal.FreeHGlobal(blob);
    }
  }

  public static int Delete(string target) {
    return CredDelete(target, 1, 0) ? 0 : Marshal.GetLastWin32Error();
  }
}
"@
  $target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$req.target))
  $out = $null
  switch ([string]$req.op) {
    'read' {
      $data = New-Object byte[] 0; $user = $null; $persist = 0; $lw = [long]0
      $err = [AgyStudioWinCred]::Read($target, [ref]$data, [ref]$user, [ref]$persist, [ref]$lw)
      if ($err -eq 1168) { $out = '{"status":"missing"}' }
      elseif ($err -ne 0) { $out = '{"status":"error","win32":' + $err + '}' }
      else {
        $u = ''
        if ($user) { $u = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($user)) }
        $out = '{"status":"ok","persist":' + $persist + ',"lastWritten":"' + $lw + '","userName":"' + $u + '","data":"' + [Convert]::ToBase64String($data) + '"}'
        [Array]::Clear($data, 0, $data.Length)
      }
    }
    'write' {
      $user = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$req.userName))
      $bytes = [Convert]::FromBase64String([string]$req.data)
      $err = [AgyStudioWinCred]::Write($target, $user, $bytes)
      [Array]::Clear($bytes, 0, $bytes.Length)
      if ($err -eq 0) { $out = '{"status":"written"}' } else { $out = '{"status":"error","win32":' + $err + '}' }
    }
    'delete' {
      $err = [AgyStudioWinCred]::Delete($target)
      if ($err -eq 0) { $out = '{"status":"deleted"}' }
      elseif ($err -eq 1168) { $out = '{"status":"missing"}' }
      else { $out = '{"status":"error","win32":' + $err + '}' }
    }
    default { throw 'unknown op' }
  }
  [Console]::Out.Write($out)
} catch {
  [Console]::Error.Write($_.Exception.GetType().FullName)
  exit 1
}
`.trim();

const ENCODED_WINCRED_SCRIPT = Buffer.from(WINCRED_SCRIPT, 'utf16le').toString('base64');

function b64utf8(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64');
}

export function buildWinCredInvocation(powershellPath: string, request: WinCredRequest): PowerShellInvocation {
  const payload: Record<string, string> = { op: request.op, target: b64utf8(request.target) };
  if (request.op === 'write') {
    payload.userName = b64utf8(request.userName);
    payload.data = request.data.toString('base64');
  }
  return {
    command: powershellPath,
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_WINCRED_SCRIPT],
    stdin: JSON.stringify(payload),
  };
}

function fileTimeToIso(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw) || raw === '0') return null;
  const ms = Number(BigInt(raw) / 10_000n - 11_644_473_600_000n);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export const runPowerShell: PowerShellRunner = (invocation, timeoutMs) => {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | null = null;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      fn();
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (child.pid) {
          void killTree(child.pid);
        } else {
          child.kill();
        }
        finish(() => reject(new AppError('INTERNAL', `Windows credential manager call timed out after ${timeoutMs}ms`)));
      }, timeoutMs);
    }

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      finish(() =>
        reject(new AppError('INTERNAL', `Failed to execute PowerShell for credential manager: ${err.message}`, { cause: err })),
      );
    });
    child.on('close', (code) => {
      finish(() => resolve({ code, stdout, stderr }));
    });

    child.stdin.on('error', () => {});
    child.stdin.end(invocation.stdin, 'utf-8');
  });
};

export class WindowsCredentialManager implements WinCredPort {
  private readonly powershellPath: string;
  private readonly platform: NodeJS.Platform;
  private readonly timeoutMs: number;
  private readonly runner: PowerShellRunner;

  constructor(options?: WindowsCredentialManagerOptions) {
    this.powershellPath = options?.powershellPath ?? 'powershell.exe';
    this.platform = options?.platform ?? process.platform;
    this.timeoutMs = options?.timeoutMs ?? 20_000;
    this.runner = options?.runner ?? runPowerShell;
  }

  async read(target: string): Promise<WinCredReadResult> {
    const res = await this.call({ op: 'read', target });
    if (res.status === 'missing') return { status: 'missing' };
    if (res.status !== 'ok' || typeof res.data !== 'string') {
      throw new AppError('INTERNAL', `Unexpected credential manager read response for "${target}"`);
    }
    const meta: WinCredEntryMeta = {
      userName: typeof res.userName === 'string' && res.userName ? Buffer.from(res.userName, 'base64').toString('utf-8') : null,
      persist: typeof res.persist === 'number' ? res.persist : null,
      lastWritten: fileTimeToIso(res.lastWritten),
    };
    const data = Buffer.from(res.data, 'base64');
    if (data.length === 0) return { status: 'empty', ...meta };
    return { status: 'ok', data, ...meta };
  }

  async write(target: string, userName: string, data: Buffer): Promise<void> {
    if (data.length === 0) {
      throw new AppError('INTERNAL', `Refusing to write an empty credential blob to "${target}"`);
    }
    const res = await this.call({ op: 'write', target, userName, data });
    if (res.status !== 'written') {
      throw new AppError('INTERNAL', `Unexpected credential manager write response for "${target}"`);
    }
  }

  async delete(target: string): Promise<boolean> {
    const res = await this.call({ op: 'delete', target });
    if (res.status === 'deleted') return true;
    if (res.status === 'missing') return false;
    throw new AppError('INTERNAL', `Unexpected credential manager delete response for "${target}"`);
  }

  private async call(request: WinCredRequest): Promise<Record<string, unknown>> {
    if (this.platform !== 'win32') {
      throw new AppError('INTERNAL', 'Windows credential manager is only supported on Windows');
    }
    const invocation = buildWinCredInvocation(this.powershellPath, request);
    const { code, stdout, stderr } = await this.runner(invocation, this.timeoutMs);
    if (code !== 0) {
      throw new AppError(
        'INTERNAL',
        `Credential manager ${request.op} for "${request.target}" failed with exit code ${code}: ${stderr.trim().slice(0, 200)}`,
      );
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new AppError('INTERNAL', `Credential manager ${request.op} for "${request.target}" returned unparseable output`);
    }
    if (parsed.status === 'error') {
      throw new AppError(
        'INTERNAL',
        `Credential manager ${request.op} for "${request.target}" failed with Win32 error ${String(parsed.win32)}`,
        { details: { win32Error: parsed.win32 } },
      );
    }
    return parsed;
  }
}

/**
 * In-memory credential manager for tests. An entry set to an empty buffer models
 * "exists but blob is empty", distinct from a missing entry.
 */
export class MemoryWinCred implements WinCredPort {
  private readonly store = new Map<string, { data: Buffer; userName: string }>();

  async read(target: string): Promise<WinCredReadResult> {
    const entry = this.store.get(target);
    if (!entry) return { status: 'missing' };
    const meta: WinCredEntryMeta = {
      userName: entry.userName || null,
      persist: CRED_PERSIST_LOCAL_MACHINE,
      lastWritten: null,
    };
    if (entry.data.length === 0) return { status: 'empty', ...meta };
    return { status: 'ok', data: Buffer.from(entry.data), ...meta };
  }

  async write(target: string, userName: string, data: Buffer): Promise<void> {
    if (data.length === 0) {
      throw new AppError('INTERNAL', `Refusing to write an empty credential blob to "${target}"`);
    }
    this.store.set(target, { data: Buffer.from(data), userName });
  }

  async delete(target: string): Promise<boolean> {
    return this.store.delete(target);
  }

  set(target: string, data: Buffer, userName = ''): void {
    this.store.set(target, { data: Buffer.from(data), userName });
  }

  get(target: string): Buffer | undefined {
    const entry = this.store.get(target);
    return entry ? Buffer.from(entry.data) : undefined;
  }

  userNameOf(target: string): string | undefined {
    return this.store.get(target)?.userName;
  }

  has(target: string): boolean {
    const entry = this.store.get(target);
    return !!entry && entry.data.length > 0;
  }

  clear(): void {
    this.store.clear();
  }
}
