import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadProfile } from '../../src/integrations/agy/profile/loader.js';
import { AgyProfileSchema } from '../../src/integrations/agy/profile/schema.js';
import { AppError } from '../../src/utils/errors.js';

describe('AgyProfile & Loader', () => {
  const profileJsonPath = path.resolve(__dirname, '../../agy-profile.json');

  it('successfully loads and validates backend/agy-profile.json', () => {
    const profile = loadProfile(profileJsonPath);
    expect(profile.agyVersion).toBe('1.2.12');
    expect(profile.binary.candidates.length).toBeGreaterThan(0);
    expect(profile.stream.multiTurnStdin).toBe(true);
    expect(profile.stream.userFrameTemplate).toBeDefined();
    expect(profile.paths.conversationDirPattern).toBeDefined();
    expect(profile.credentials.preferredIsolation).toBe('isolated_home');
    expect(profile.login.argv).toContain('login');
    expect(profile.quota.usageCommand).toBe('/usage');
    expect(profile.catalog.modelsParser).toBe('text-v1');
  });

  it('throws AppError with NOT_FOUND for non-existent file', () => {
    const nonExistentPath = path.resolve(__dirname, '../../non-existent-profile.json');
    expect(() => loadProfile(nonExistentPath)).toThrowError(AppError);
    try {
      loadProfile(nonExistentPath);
    } catch (err) {
      const appErr = err as AppError;
      expect(appErr.code).toBe('NOT_FOUND');
    }
  });

  it('throws AppError with BAD_REQUEST for invalid JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-profile-test-'));
    const invalidJsonPath = path.join(tmpDir, 'invalid.json');
    fs.writeFileSync(invalidJsonPath, '{ invalid json');

    try {
      expect(() => loadProfile(invalidJsonPath)).toThrowError(AppError);
      try {
        loadProfile(invalidJsonPath);
      } catch (err) {
        const appErr = err as AppError;
        expect(appErr.code).toBe('BAD_REQUEST');
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('gives exact field paths on missing fields or type errors', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-profile-test-'));
    const badProfilePath = path.join(tmpDir, 'bad-profile.json');

    // Missing agyVersion, invalid type for binary.candidates (number instead of string[]), missing paths
    const badProfile = {
      discoveredAt: '2026-09-28T00:00:00.000Z',
      binary: {
        candidates: 12345,
      },
      stream: {
        userFrameTemplate: null, // invalid, should be string or record
        multiTurnStdin: 'not-a-bool',
        eventTypeMap: {},
      },
    };

    fs.writeFileSync(badProfilePath, JSON.stringify(badProfile, null, 2));

    try {
      let caughtError: AppError | undefined;
      try {
        loadProfile(badProfilePath);
      } catch (err) {
        caughtError = err as AppError;
      }

      expect(caughtError).toBeInstanceOf(AppError);
      expect(caughtError?.code).toBe('BAD_REQUEST');

      const details = caughtError?.details as {
        path: string;
        errors: Array<{ path: string; message: string; code: string }>;
      };
      expect(details).toBeDefined();
      expect(Array.isArray(details.errors)).toBe(true);

      const paths = details.errors.map((e) => e.path);

      // Verify exact paths are detected
      expect(paths).toContain('agyVersion');
      expect(paths).toContain('binary.candidates');
      expect(paths).toContain('stream.userFrameTemplate');
      expect(paths).toContain('stream.multiTurnStdin');
      expect(paths).toContain('paths');
      expect(paths).toContain('settings');
      expect(paths).toContain('credentials');
      expect(paths).toContain('login');
      expect(paths).toContain('quota');
      expect(paths).toContain('catalog');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('AgyProfileSchema parses direct object', () => {
    const raw = JSON.parse(fs.readFileSync(profileJsonPath, 'utf-8'));
    const parsed = AgyProfileSchema.parse(raw);
    expect(parsed.catalog.modes).toContain('plan');
  });
});
