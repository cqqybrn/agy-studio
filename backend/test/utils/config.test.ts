import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLoopbackHost, loadConfig, resolveDataDir } from '../../src/utils/config.js';
import { AppError } from '../../src/utils/errors.js';

describe('utils/config', () => {
  describe('isLoopbackHost', () => {
    it('recognizes localhost and IPv4 loopbacks', () => {
      expect(isLoopbackHost('127.0.0.1')).toBe(true);
      expect(isLoopbackHost('localhost')).toBe(true);
      expect(isLoopbackHost('127.0.0.2')).toBe(true);
      expect(isLoopbackHost('127.255.255.254')).toBe(true);
    });

    it('recognizes IPv6 loopback addresses', () => {
      expect(isLoopbackHost('::1')).toBe(true);
      expect(isLoopbackHost('[::1]')).toBe(true);
      expect(isLoopbackHost('::ffff:127.0.0.1')).toBe(true);
    });

    it('rejects non-loopback addresses', () => {
      expect(isLoopbackHost('0.0.0.0')).toBe(false);
      expect(isLoopbackHost('192.168.1.100')).toBe(false);
      expect(isLoopbackHost('10.0.0.1')).toBe(false);
      expect(isLoopbackHost('example.com')).toBe(false);
    });
  });

  describe('resolveDataDir', () => {
    it('defaults to ~/.agy-studio', () => {
      const resolved = resolveDataDir();
      expect(resolved).toBe(path.join(os.homedir(), '.agy-studio'));
    });

    it('expands ~ prefix properly', () => {
      expect(resolveDataDir('~')).toBe(os.homedir());
      expect(resolveDataDir('~/custom/data')).toBe(path.join(os.homedir(), 'custom', 'data'));
    });

    it('resolves relative and absolute paths', () => {
      const absPath = path.resolve('temp-dir');
      expect(resolveDataDir('temp-dir')).toBe(absPath);
    });
  });

  describe('loadConfig', () => {
    it('loads default values on 127.0.0.1 without token', () => {
      const config = loadConfig({});
      expect(config.host).toBe('127.0.0.1');
      expect(config.port).toBe(8790);
      expect(config.token).toBeUndefined();
      expect(config.agyBin).toBeUndefined();
      expect(config.dataDir).toBe(path.join(os.homedir(), '.agy-studio'));
    });

    it('allows non-loopback when token is provided', () => {
      const config = loadConfig({
        HOST: '0.0.0.0',
        PORT: '9000',
        AGY_STUDIO_TOKEN: 'secret-token-123',
        AGY_BIN: 'C:\\agy\\agy.exe',
        DATA_DIR: 'D:\\agy-data',
      });
      expect(config.host).toBe('0.0.0.0');
      expect(config.port).toBe(9000);
      expect(config.token).toBe('secret-token-123');
      expect(config.agyBin).toBe('C:\\agy\\agy.exe');
      expect(config.dataDir).toBe(path.resolve('D:\\agy-data'));
    });

    it('throws UNAUTHORIZED when host is non-loopback and token is missing', () => {
      expect(() => {
        loadConfig({ HOST: '0.0.0.0' });
      }).toThrowError(AppError);

      try {
        loadConfig({ HOST: '192.168.0.2' });
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('UNAUTHORIZED');
      }
    });

    it('throws BAD_REQUEST when port is invalid', () => {
      expect(() => {
        loadConfig({ PORT: 'abc' });
      }).toThrowError(AppError);

      expect(() => {
        loadConfig({ PORT: '999999' });
      }).toThrowError(AppError);
    });
  });
});
