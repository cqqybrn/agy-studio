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
import type { AgyProfile } from '../../src/integrations/agy/profile/schema.js';

describe('Settings integration (AgySettings)', () => {
  let tmpDir: string;
  let mockProfile: AgyProfile;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-settings-test-'));

    mockProfile = {
      agyVersion: '1.2.12',
      discoveredAt: '2026-09-28T00:00:00.000Z',
      binary: { candidates: ['agy'] },
      stream: {
        userFrameTemplate: '{"event":"user","message":{"content":"{{prompt}}"}}',
        multiTurnStdin: true,
        eventTypeMap: {},
        permissionEvent: null,
        imageInput: { supported: false, template: null },
      },
      paths: {
        dataRoots: ['%USERPROFILE%\\.antigravity'],
        conversationDirPattern: '%USERPROFILE%\\.antigravity\\conversations\\{{conversationId}}',
        transcriptRelPath: 'transcript.jsonl',
        artifactRules: [],
      },
      settings: {
        files: [
          {
            scope: 'user',
            pathTemplate: '%USERPROFILE%\\.antigravity\\settings.json',
          },
          {
            scope: 'workspace',
            pathTemplate: '{{workspacePath}}\\.antigravity\\settings.json',
          },
        ],
        alwaysProceed: {
          jsonPath: 'security.alwaysProceed',
          value: true,
        },
        statusline: {
          jsonPath: 'statusline',
        },
      },
      credentials: {
        preferredIsolation: 'isolated_home',
        homeEnvVars: ['USERPROFILE', 'HOME'],
        wincredTargetPatterns: [],
        credentialFiles: [],
      },
      login: {
        argv: ['login'],
        authUrlPattern: 'https?://',
        successPatterns: ['ok'],
        failurePatterns: ['fail'],
      },
      quota: {
        statuslineInHeadless: false,
        usageCommand: '/usage',
        usageParser: 'text-v1',
      },
      catalog: {
        versionArgv: ['--version'],
        modelsArgv: ['models'],
        modelsParser: 'text-v1',
        modes: ['default'],
      },
    };
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    vi.restoreAllMocks();
  });

  describe('Path resolution', () => {
    it('resolves workspace path correctly using {{workspacePath}}', () => {
      const resolved = resolveSettingsPath('workspace', mockProfile, {
        workspacePath: tmpDir,
      });
      expect(resolved).toBe(path.resolve(path.join(tmpDir, '.antigravity', 'settings.json')));
    });

    it('resolves global path with isolated homeDir override', () => {
      const customHome = path.join(tmpDir, 'custom-home');
      const resolved = resolveSettingsPath('global', mockProfile, {
        homeDir: customHome,
      });
      expect(resolved).toBe(path.resolve(path.join(customHome, '.antigravity', 'settings.json')));
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
        security: { other: 123 },
      };
      expect(getByPath(obj, 'security.other')).toBe(123);
      expect(getByPath(obj, 'security.alwaysProceed')).toBeUndefined();

      const changed = setByPath(obj, 'security.alwaysProceed', true);
      expect(changed).toBe(true);
      expect(getByPath(obj, 'security.alwaysProceed')).toBe(true);
      expect(obj.existing).toBe('val');
      expect((obj.security as any).other).toBe(123);

      const unchanged = setByPath(obj, 'security.alwaysProceed', true);
      expect(unchanged).toBe(false);
    });
  });

  describe('ensureAlwaysProceed file operations', () => {
    it('creates settings file if it does not exist with default formatting', async () => {
      const settings = new AgySettings(mockProfile);
      const wsDir = path.join(tmpDir, 'project');

      const result = await settings.ensureAlwaysProceed('workspace', {
        workspacePath: wsDir,
      });

      expect(result.updated).toBe(true);
      expect(result.warning).toBeUndefined();
      expect(fs.existsSync(result.filePath)).toBe(true);

      const parsed = JSON.parse(fs.readFileSync(result.filePath, 'utf-8'));
      expect(parsed).toEqual({
        security: {
          alwaysProceed: true,
        },
      });
    });

    it('preserves all other fields and 4-space indentation byte-for-byte', async () => {
      const settings = new AgySettings(mockProfile);
      const wsDir = path.join(tmpDir, 'project4');
      const settingsPath = path.join(wsDir, '.antigravity', 'settings.json');
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

      const initialContent =
        '{\n' +
        '    "customConfig": {\n' +
        '        "enabled": true,\n' +
        '        "tags": [\n' +
        '            "a",\n' +
        '            "b"\n' +
        '        ]\n' +
        '    },\n' +
        '    "security": {\n' +
        '        "otherFlag": "preserve-me"\n' +
        '    },\n' +
        '    "userName": "Torres"\n' +
        '}\n';

      fs.writeFileSync(settingsPath, initialContent, 'utf-8');

      const result = await settings.ensureAlwaysProceed('workspace', {
        workspacePath: wsDir,
      });

      expect(result.updated).toBe(true);
      expect(result.warning).toBeUndefined();

      const updatedRaw = fs.readFileSync(settingsPath, 'utf-8');
      const updatedJson = JSON.parse(updatedRaw);

      // Verify custom fields preserved
      expect(updatedJson.customConfig).toEqual({
        enabled: true,
        tags: ['a', 'b'],
      });
      expect(updatedJson.security.otherFlag).toBe('preserve-me');
      expect(updatedJson.security.alwaysProceed).toBe(true);
      expect(updatedJson.userName).toBe('Torres');

      // Verify 4-space indentation format was maintained
      const lines = updatedRaw.split('\n');
      expect(lines.some((l) => l.startsWith('    "customConfig"'))).toBe(true);
      expect(lines.some((l) => l.startsWith('        "enabled"'))).toBe(true);
    });

    it('preserves tab indentation and CRLF newlines', async () => {
      const settings = new AgySettings(mockProfile);
      const wsDir = path.join(tmpDir, 'project-tab');
      const settingsPath = path.join(wsDir, '.antigravity', 'settings.json');
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

      const initialContent = '{\r\n\t"theme": "dark"\r\n}\r\n';
      fs.writeFileSync(settingsPath, initialContent, 'utf-8');

      const result = await settings.ensureAlwaysProceed('workspace', {
        workspacePath: wsDir,
      });

      expect(result.updated).toBe(true);
      const updatedRaw = fs.readFileSync(settingsPath, 'utf-8');
      expect(updatedRaw).toContain('\r\n');
      expect(updatedRaw).toContain('\t"theme": "dark"');
      expect(updatedRaw).toContain('\t"security": {');
    });

    it('returns updated: false if alwaysProceed is already configured to the desired value', async () => {
      const settings = new AgySettings(mockProfile);
      const wsDir = path.join(tmpDir, 'project-already');
      const settingsPath = path.join(wsDir, '.antigravity', 'settings.json');
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

      const initialContent = JSON.stringify(
        {
          security: {
            alwaysProceed: true,
          },
          foo: 'bar',
        },
        null,
        2,
      );
      fs.writeFileSync(settingsPath, initialContent, 'utf-8');

      const result = await settings.ensureAlwaysProceed('workspace', {
        workspacePath: wsDir,
      });

      expect(result.updated).toBe(false);
      expect(result.warning).toBeUndefined();
    });

    it('returns warning instead of throwing if existing settings file has invalid JSON', async () => {
      const settings = new AgySettings(mockProfile);
      const wsDir = path.join(tmpDir, 'project-bad');
      const settingsPath = path.join(wsDir, '.antigravity', 'settings.json');
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

      fs.writeFileSync(settingsPath, 'NOT A VALID JSON {{{', 'utf-8');

      const result = await settings.ensureAlwaysProceed('workspace', {
        workspacePath: wsDir,
      });

      expect(result.updated).toBe(false);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('Failed to read or parse');
    });

    it('retries write on failure and returns warning without throwing if still failing', async () => {
      const settings = new AgySettings(mockProfile);
      const wsDir = path.join(tmpDir, 'project-retry');

      let callCount = 0;
      const originalRename = fs.promises.rename;
      vi.spyOn(fs.promises, 'rename').mockImplementation(async (oldPath, newPath) => {
        callCount++;
        throw new Error('EACCES: permission denied, rename');
      });

      const result = await settings.ensureAlwaysProceed('workspace', {
        workspacePath: wsDir,
      });

      expect(callCount).toBe(2); // Initial attempt + 1 retry
      expect(result.updated).toBe(false);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('Failed to write settings file');
    });

    it('succeeds if retry write succeeds on second attempt', async () => {
      const settings = new AgySettings(mockProfile);
      const wsDir = path.join(tmpDir, 'project-retry-succeed');

      let callCount = 0;
      const originalRename = fs.promises.rename;
      vi.spyOn(fs.promises, 'rename').mockImplementation(async (oldPath, newPath) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('EBUSY: resource busy or locked');
        }
        return originalRename(oldPath, newPath);
      });

      const result = await settings.ensureAlwaysProceed('workspace', {
        workspacePath: wsDir,
      });

      expect(callCount).toBe(2);
      expect(result.updated).toBe(true);
      expect(result.warning).toBeUndefined();
      expect(fs.existsSync(result.filePath)).toBe(true);
    });
  });
});
