import { describe, it, expect } from 'vitest';
import { WindowsDpapi, MemoryDpapi, dpapi } from '../../src/integrations/agy/dpapi.js';
import { AppError } from '../../src/utils/errors.js';

describe('DPAPI Integration', () => {
  describe('MemoryDpapi', () => {
    const memoryDpapi = new MemoryDpapi();

    it('protects and unprotects data correctly', async () => {
      const plaintext = Buffer.from('my-secret-credential-value');
      const ciphertext = await memoryDpapi.protect(plaintext);
      expect(ciphertext.equals(plaintext)).toBe(false);

      const decrypted = await memoryDpapi.unprotect(ciphertext);
      expect(decrypted.toString()).toBe('my-secret-credential-value');
    });

    it('handles empty buffer', async () => {
      const empty = Buffer.alloc(0);
      const ciphertext = await memoryDpapi.protect(empty);
      expect(ciphertext.length).toBe(0);

      const decrypted = await memoryDpapi.unprotect(ciphertext);
      expect(decrypted.length).toBe(0);
    });

    it('throws AppError on corrupted ciphertext', async () => {
      const corrupted = Buffer.from('not-encrypted-bytes');
      await expect(memoryDpapi.unprotect(corrupted)).rejects.toThrow(AppError);
    });
  });

  describe('WindowsDpapi on non-Windows platforms', () => {
    it('throws AppError when platform is not win32', async () => {
      const linuxDpapi = new WindowsDpapi({ platform: 'linux' });
      await expect(linuxDpapi.protect(Buffer.from('hello'))).rejects.toThrow(AppError);
      await expect(linuxDpapi.unprotect(Buffer.from('hello'))).rejects.toThrow(AppError);

      try {
        await linuxDpapi.protect(Buffer.from('hello'));
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('INTERNAL');
      }
    });
  });

  // Execute real Windows DPAPI if on win32
  if (process.platform === 'win32') {
    describe('Real WindowsDpapi on win32', () => {
      it('encrypts and decrypts buffer via PowerShell DPAPI CurrentUser', async () => {
        const plaintext = Buffer.from(JSON.stringify({ token: 'test-oauth-token', id: 123 }));
        const encrypted = await dpapi.protect(plaintext);
        expect(encrypted.length).toBeGreaterThan(0);
        expect(encrypted.equals(plaintext)).toBe(false);

        const decrypted = await dpapi.unprotect(encrypted);
        expect(decrypted.toString('utf-8')).toBe(plaintext.toString('utf-8'));
      }, 15_000);

      it('handles empty buffer without launching PowerShell', async () => {
        const empty = Buffer.alloc(0);
        const encrypted = await dpapi.protect(empty);
        expect(encrypted.length).toBe(0);
        const decrypted = await dpapi.unprotect(encrypted);
        expect(decrypted.length).toBe(0);
      });

      it('throws AppError on invalid ciphertext', async () => {
        const garbage = Buffer.from('this is definitely not dpapi encrypted data');
        await expect(dpapi.unprotect(garbage)).rejects.toThrow(AppError);
      });

      it('times out and throws AppError when execution exceeds timeoutMs', async () => {
        const timeoutDpapi = new WindowsDpapi({ timeoutMs: 1 });
        const data = Buffer.from('hello world');
        await expect(timeoutDpapi.protect(data)).rejects.toThrow(AppError);
        try {
          await timeoutDpapi.protect(data);
        } catch (err) {
          expect(err).toBeInstanceOf(AppError);
          expect((err as AppError).message).toContain('timed out');
        }
      });
    });
  }
});
