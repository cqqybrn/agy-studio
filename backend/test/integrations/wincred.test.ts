import { describe, it, expect } from 'vitest';
import {
  WindowsCredentialManager,
  buildWinCredInvocation,
  type PowerShellInvocation,
  type PowerShellResult,
} from '../../src/integrations/agy/wincred.js';
import { AppError } from '../../src/utils/errors.js';

const SECRET = '{"auth_method":"consumer","token":{"refresh_token":"1//super-secret-refresh"}}';

function fakeRunner(respond: (req: Record<string, string>) => PowerShellResult) {
  const calls: PowerShellInvocation[] = [];
  const runner = async (inv: PowerShellInvocation): Promise<PowerShellResult> => {
    calls.push(inv);
    return respond(JSON.parse(inv.stdin));
  };
  return { calls, runner };
}

const ok = (payload: unknown): PowerShellResult => ({ code: 0, stdout: JSON.stringify(payload), stderr: '' });

describe('Windows credential manager wrapper', () => {
  describe('buildWinCredInvocation', () => {
    it('keeps target, user name and secret out of the command line', () => {
      const secretBuf = Buffer.from(SECRET, 'utf-8');
      const inv = buildWinCredInvocation('powershell.exe', {
        op: 'write',
        target: 'gemini:antigravity',
        userName: 'antigravity',
        data: secretBuf,
      });

      expect(inv.command).toBe('powershell.exe');
      expect(inv.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
      expect(inv.args).toHaveLength(4);

      const script = Buffer.from(inv.args[3], 'base64').toString('utf16le');
      const commandLine = [...inv.args, script].join(' ');
      for (const needle of [SECRET, secretBuf.toString('base64'), 'super-secret-refresh', 'gemini:antigravity']) {
        expect(commandLine).not.toContain(needle);
      }

      const stdin = JSON.parse(inv.stdin);
      expect(stdin.op).toBe('write');
      expect(Buffer.from(stdin.data, 'base64').equals(secretBuf)).toBe(true);
      expect(Buffer.from(stdin.target, 'base64').toString('utf-8')).toBe('gemini:antigravity');
      expect(Buffer.from(stdin.userName, 'base64').toString('utf-8')).toBe('antigravity');
    });

    it('uses the same constant script for every operation', () => {
      const a = buildWinCredInvocation('powershell.exe', { op: 'read', target: 'x:1' });
      const b = buildWinCredInvocation('powershell.exe', { op: 'delete', target: 'y:2' });
      expect(a.args).toEqual(b.args);
      expect(JSON.parse(a.stdin)).toEqual({ op: 'read', target: Buffer.from('x:1').toString('base64') });
    });

    it('script calls the Win32 credential APIs with generic type and local-machine persistence', () => {
      const inv = buildWinCredInvocation('powershell.exe', { op: 'read', target: 't' });
      const script = Buffer.from(inv.args[3], 'base64').toString('utf16le');
      expect(script).toContain('CredReadW');
      expect(script).toContain('CredWriteW');
      expect(script).toContain('CredDeleteW');
      expect(script).toContain('c.Type = 1');
      expect(script).toContain('c.Persist = 2');
      expect(script).not.toMatch(/keyring/i);
    });
  });

  describe('WindowsCredentialManager with a fake runner', () => {
    it('read distinguishes missing, empty and populated entries', async () => {
      const responses: Record<string, PowerShellResult> = {
        'none:x': ok({ status: 'missing' }),
        'empty:x': ok({ status: 'ok', persist: 2, lastWritten: '0', userName: '', data: '' }),
        'full:x': ok({
          status: 'ok',
          persist: 2,
          lastWritten: String((BigInt(Date.parse('2026-09-28T18:49:44.590Z')) + 11_644_473_600_000n) * 10_000n + 3722n),
          userName: Buffer.from('antigravity').toString('base64'),
          data: Buffer.from(SECRET).toString('base64'),
        }),
      };
      const { runner } = fakeRunner((req) => responses[Buffer.from(req.target, 'base64').toString()]);
      const mgr = new WindowsCredentialManager({ platform: 'win32', runner });

      expect(await mgr.read('none:x')).toEqual({ status: 'missing' });

      const empty = await mgr.read('empty:x');
      expect(empty).toMatchObject({ status: 'empty', userName: null, persist: 2, lastWritten: null });

      const full = await mgr.read('full:x');
      expect(full.status).toBe('ok');
      if (full.status !== 'ok') throw new Error('unreachable');
      expect(full.data.toString()).toBe(SECRET);
      expect(full.userName).toBe('antigravity');
      expect(full.persist).toBe(2);
      expect(full.lastWritten).toBe('2026-09-28T18:49:44.590Z');
    });

    it('write sends the secret only through stdin', async () => {
      const { calls, runner } = fakeRunner(() => ok({ status: 'written' }));
      const mgr = new WindowsCredentialManager({ platform: 'win32', runner });
      await mgr.write('agy-studio-test:abc', 'antigravity', Buffer.from(SECRET));

      expect(calls).toHaveLength(1);
      expect(calls[0].args.join(' ')).not.toContain(Buffer.from(SECRET).toString('base64'));
      expect(calls[0].stdin).toContain(Buffer.from(SECRET).toString('base64'));
    });

    it('write refuses an empty blob without spawning PowerShell', async () => {
      const { calls, runner } = fakeRunner(() => ok({ status: 'written' }));
      const mgr = new WindowsCredentialManager({ platform: 'win32', runner });
      await expect(mgr.write('agy-studio-test:abc', 'antigravity', Buffer.alloc(0))).rejects.toThrow(AppError);
      expect(calls).toHaveLength(0);
    });

    it('delete reports whether the entry existed', async () => {
      let next: PowerShellResult = ok({ status: 'deleted' });
      const { runner } = fakeRunner(() => next);
      const mgr = new WindowsCredentialManager({ platform: 'win32', runner });
      expect(await mgr.delete('t:1')).toBe(true);
      next = ok({ status: 'missing' });
      expect(await mgr.delete('t:1')).toBe(false);
    });

    it('maps Win32 errors and non-zero exits to AppError without echoing the secret', async () => {
      let next: PowerShellResult = ok({ status: 'error', win32: 5 });
      const { runner } = fakeRunner(() => next);
      const mgr = new WindowsCredentialManager({ platform: 'win32', runner });

      const err1 = await mgr.write('t:1', 'u', Buffer.from(SECRET)).catch((e: unknown) => e);
      expect(err1).toBeInstanceOf(AppError);
      expect((err1 as AppError).message).toContain('Win32 error 5');
      expect((err1 as AppError).message).not.toContain('super-secret');

      next = { code: 1, stdout: Buffer.from(SECRET).toString('base64'), stderr: 'System.FormatException' };
      const err2 = await mgr.read('t:1').catch((e: unknown) => e);
      expect(err2).toBeInstanceOf(AppError);
      expect((err2 as AppError).message).toContain('exit code 1');
      expect((err2 as AppError).message).not.toContain(Buffer.from(SECRET).toString('base64'));
    });

    it('refuses to run on non-Windows platforms', async () => {
      const { calls, runner } = fakeRunner(() => ok({ status: 'missing' }));
      const mgr = new WindowsCredentialManager({ platform: 'linux', runner });
      await expect(mgr.read('t:1')).rejects.toThrow(AppError);
      expect(calls).toHaveLength(0);
    });
  });
});
