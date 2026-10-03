import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgySettings,
  detectJsonFormatting,
  formatJson,
  getByPath,
  resolveSettingsPath,
  setByPath,
} from '../../src/integrations/agy/settings.js';
import { loadProfile } from '../../src/integrations/agy/profile/loader.js';
import type { AgyProfile } from '../../src/integrations/agy/profile/schema.js';

const PROFILE: AgyProfile = loadProfile(path.resolve(__dirname, '../../agy-profile.json'));
const REAL_USER_SETTINGS = path.resolve(
  __dirname,
  '../../../fixtures/agy/settings/user-settings.json',
);

describe('Settings integration (AgySettings)', () => {
  let tmpDir: string;
  let homeDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-settings-test-'));
    homeDir = path.join(tmpDir, 'home');
    settingsPath = path.join(homeDir, '.gemini', 'antigravity-cli', 'settings.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    vi.restoreAllMocks();
  });

  const writeSettings = (content: string) => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, content, 'utf-8');
  };

  describe('Profile settings config', () => {
    it('declares only the user settings file and toolPermission = "always-proceed"', () => {
      expect(PROFILE.settings.files).toEqual([
        { scope: 'user', pathTemplate: '%USERPROFILE%\\.gemini\\antigravity-cli\\settings.json' },
      ]);
      expect(PROFILE.settings.alwaysProceed).toEqual({
        jsonPath: 'toolPermission',
        value: 'always-proceed',
      });
      expect(PROFILE.stream.permissionEvent).toBeNull();
    });
  });

  describe('Path resolution', () => {
    it('resolves global path under <home>\\.gemini\\antigravity-cli with isolated homeDir override', () => {
      const resolved = resolveSettingsPath('global', PROFILE, { homeDir });
      expect(resolved).toBe(path.resolve(settingsPath));
    });

    it('returns null for workspace scope because the profile declares no workspace file', () => {
      expect(resolveSettingsPath('workspace', PROFILE, { workspacePath: tmpDir })).toBeNull();
    });
  });

  describe('JSON formatting & path utilities', () => {
    it('detects 2 spaces, 4 spaces, and tab indentation correctly', () => {
      expect(detectJsonFormatting('{\n  "a": 1\n}').indent).toBe(2);
      expect(detectJsonFormatting('{\n    "a": 1\n}').indent).toBe(4);
      expect(detectJsonFormatting('{\n\t"a": 1\n}').indent).toBe('\t');
    });

    it('detects newline and trailing newline', () => {
      const crlf = detectJsonFormatting('{\r\n  "a": 1\r\n}\r\n');
      expect(crlf.newline).toBe('\r\n');
      expect(crlf.trailingNewline).toBe(true);

      const lfNoTrailing = detectJsonFormatting('{\n  "a": 1\n}');
      expect(lfNoTrailing.newline).toBe('\n');
      expect(lfNoTrailing.trailingNewline).toBe(false);
    });

    it('get and set nested values using dot notation', () => {
      const obj: Record<string, unknown> = {
        existing: 'val',
        nested: { other: 123 },
      };
      expect(getByPath(obj, 'nested.other')).toBe(123);
      expect(getByPath(obj, 'nested.flag')).toBeUndefined();

      const changed = setByPath(obj, 'nested.flag', true);
      expect(changed).toBe(true);
      expect(getByPath(obj, 'nested.flag')).toBe(true);
      expect(obj.existing).toBe('val');
      expect((obj.nested as any).other).toBe(123);

      const unchanged = setByPath(obj, 'nested.flag', true);
      expect(unchanged).toBe(false);
    });

    it('compares and writes string values at a top-level jsonPath', () => {
      const obj: Record<string, unknown> = { toolPermission: 'always-proceed' };
      expect(setByPath(obj, 'toolPermission', 'always-proceed')).toBe(false);

      const boolValued: Record<string, unknown> = { toolPermission: true };
      expect(setByPath(boolValued, 'toolPermission', 'always-proceed')).toBe(true);
      expect(boolValued.toolPermission).toBe('always-proceed');
    });

    it('formatJson keeps detected formatting', () => {
      const out = formatJson({ a: 1 }, { indent: 4, newline: '\r\n', trailingNewline: true });
      expect(out).toBe('{\r\n    "a": 1\r\n}\r\n');
    });
  });

  describe('ensureAlwaysProceed file operations', () => {
    it('leaves the real recorded settings.json untouched (already always-proceed)', async () => {
      const original = fs.readFileSync(REAL_USER_SETTINGS, 'utf-8');
      writeSettings(original);

      const result = await new AgySettings(PROFILE).ensureAlwaysProceed('global', { homeDir });

      expect(result).toEqual({ updated: false, filePath: path.resolve(settingsPath) });
      expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(original);
    });

    it('adds toolPermission as a string and preserves artifactReviewPolicy', async () => {
      writeSettings('{\n  "artifactReviewPolicy": "always-proceed"\n}\n');

      const result = await new AgySettings(PROFILE).ensureAlwaysProceed('global', { homeDir });

      expect(result.updated).toBe(true);
      expect(result.warning).toBeUndefined();
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(parsed).toEqual({
        artifactReviewPolicy: 'always-proceed',
        toolPermission: 'always-proceed',
      });
      expect(typeof parsed.toolPermission).toBe('string');
    });

    it('overwrites a non-matching toolPermission value and keeps other keys', async () => {
      writeSettings(
        JSON.stringify({ artifactReviewPolicy: 'always-proceed', toolPermission: true }, null, 2),
      );

      const result = await new AgySettings(PROFILE).ensureAlwaysProceed('global', { homeDir });

      expect(result.updated).toBe(true);
      expect(JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))).toEqual({
        artifactReviewPolicy: 'always-proceed',
        toolPermission: 'always-proceed',
      });
    });

    it('creates the settings file if it does not exist', async () => {
      const result = await new AgySettings(PROFILE).ensureAlwaysProceed('global', { homeDir });

      expect(result.updated).toBe(true);
      expect(result.filePath).toBe(path.resolve(settingsPath));
      expect(JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))).toEqual({
        toolPermission: 'always-proceed',
      });
    });

    it('does nothing and warns nothing for workspace scope (no workspace file in profile)', async () => {
      const wsDir = path.join(tmpDir, 'project');
      const result = await new AgySettings(PROFILE).ensureAlwaysProceed('workspace', {
        workspacePath: wsDir,
      });

      expect(result).toEqual({ updated: false, filePath: '' });
      expect(fs.existsSync(wsDir)).toBe(false);
    });

    it('preserves all other fields and 4-space indentation', async () => {
      writeSettings(
        '{\n' +
          '    "artifactReviewPolicy": "always-proceed",\n' +
          '    "customConfig": {\n' +
          '        "enabled": true,\n' +
          '        "tags": [\n' +
          '            "a",\n' +
          '            "b"\n' +
          '        ]\n' +
          '    }\n' +
          '}\n',
      );

      const result = await new AgySettings(PROFILE).ensureAlwaysProceed('global', { homeDir });

      expect(result.updated).toBe(true);
      const updatedRaw = fs.readFileSync(settingsPath, 'utf-8');
      const updatedJson = JSON.parse(updatedRaw);
      expect(updatedJson.customConfig).toEqual({ enabled: true, tags: ['a', 'b'] });
      expect(updatedJson.artifactReviewPolicy).toBe('always-proceed');
      expect(updatedJson.toolPermission).toBe('always-proceed');

      const lines = updatedRaw.split('\n');
      expect(lines.some((l) => l.startsWith('    "customConfig"'))).toBe(true);
      expect(lines.some((l) => l.startsWith('        "enabled"'))).toBe(true);
    });

    it('preserves tab indentation and CRLF newlines', async () => {
      writeSettings('{\r\n\t"artifactReviewPolicy": "always-proceed"\r\n}\r\n');

      const result = await new AgySettings(PROFILE).ensureAlwaysProceed('global', { homeDir });

      expect(result.updated).toBe(true);
      const updatedRaw = fs.readFileSync(settingsPath, 'utf-8');
      expect(updatedRaw).toContain('\r\n');
      expect(updatedRaw).toContain('\t"artifactReviewPolicy": "always-proceed"');
      expect(updatedRaw).toContain('\t"toolPermission": "always-proceed"');
    });

    it('returns warning instead of throwing if existing settings file has invalid JSON', async () => {
      writeSettings('NOT A VALID JSON {{{');

      const result = await new AgySettings(PROFILE).ensureAlwaysProceed('global', { homeDir });

      expect(result.updated).toBe(false);
      expect(result.warning).toContain('Failed to read or parse');
    });

    it('retries write on failure and returns warning without throwing if still failing', async () => {
      let callCount = 0;
      vi.spyOn(fs.promises, 'rename').mockImplementation(async () => {
        callCount++;
        throw new Error('EACCES: permission denied, rename');
      });

      const result = await new AgySettings(PROFILE).ensureAlwaysProceed('global', { homeDir });

      expect(callCount).toBe(2); // Initial attempt + 1 retry
      expect(result.updated).toBe(false);
      expect(result.warning).toContain('Failed to write settings file');
    });

    it('succeeds if retry write succeeds on second attempt', async () => {
      let callCount = 0;
      const originalRename = fs.promises.rename;
      vi.spyOn(fs.promises, 'rename').mockImplementation(async (oldPath, newPath) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('EBUSY: resource busy or locked');
        }
        return originalRename(oldPath, newPath);
      });

      const result = await new AgySettings(PROFILE).ensureAlwaysProceed('global', { homeDir });

      expect(callCount).toBe(2);
      expect(result.updated).toBe(true);
      expect(result.warning).toBeUndefined();
      expect(fs.existsSync(result.filePath)).toBe(true);
    });
  });
});
