import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AgyCatalog,
  findAgyBinary,
  parseModelsOutput,
  parseVersionOutput,
} from '../../src/integrations/agy/catalog.js';
import { AppError } from '../../src/utils/errors.js';
import type { AgyProfile } from '../../src/integrations/agy/profile/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../../');

describe('AgyCatalog & CLI parser integration', () => {
  const fixturesDir = path.join(rootDir, 'fixtures/agy/catalog');
  const modelsTxt = fs.readFileSync(path.join(fixturesDir, 'models.txt'), 'utf-8');
  const versionTxt = fs.readFileSync(path.join(fixturesDir, 'version.txt'), 'utf-8');

  it('models 解析快照测试 (fixtures/agy/catalog/models.txt)', () => {
    const models = parseModelsOutput(modelsTxt);

    // 验证快照
    expect(models).toMatchSnapshot();

    // 验证条目数量与分组规则
    expect(models).toHaveLength(14);
    for (const m of models) {
      if (m.id.startsWith('gemini')) {
        expect(m.group).toBe('gemini');
      } else {
        expect(m.group).toBe('third_party');
      }
      expect(m.isDefault).toBe(false);
      expect(m.label.length).toBeGreaterThan(0);
    }

    const sonnet = models.find((m) => m.id === 'claude-sonnet-4-6');
    expect(sonnet).toEqual({
      id: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6 (Thinking)',
      group: 'third_party',
      isDefault: false,
    });
  });

  it('version 解析测试 (fixtures/agy/catalog/version.txt)', () => {
    expect(parseVersionOutput(versionTxt)).toBe('1.2.12');
    expect(parseVersionOutput('agy version 2.5.0-alpha.1 (built today)\n')).toBe('2.5.0-alpha.1');
    expect(parseVersionOutput('random string without version')).toBeNull();
  });

  it('listModes 返回 profile.catalog.modes', async () => {
    const catalog = new AgyCatalog();
    const modes = await catalog.listModes();
    expect(modes).toEqual(['accept-edits', 'plan']);
  });

  it('未安装 agy 时 listModels 降级抛出 AGY_NOT_INSTALLED 错误', async () => {
    const dummyProfile: AgyProfile = {
      agyVersion: '1.2.12',
      discoveredAt: new Date().toISOString(),
      binary: { candidates: ['/nonexistent/path/to/never/installed/agy'] },
      stream: {
        userFrameTemplate: '{{prompt}}',
        multiTurnStdin: false,
        eventTypeMap: {},
        permissionEvent: null,
        imageInput: { supported: false, template: null },
      },
      paths: {
        dataRoots: ['/dummy'],
        conversationDirPattern: '/dummy/{{conversationId}}',
        transcriptRelPath: 't.jsonl',
        artifactRules: [],
      },
      settings: {
        files: [{ scope: 'user', pathTemplate: '/dummy/s.json' }],
        alwaysProceed: { jsonPath: 'a', value: 'b' },
        statusline: { jsonPath: 's' },
      },
      credentials: {
        preferredIsolation: 'credential_snapshot',
        homeEnvVars: ['HOME'],
        wincredTargetPatterns: [],
        credentialFiles: [],
      },
      login: { argv: ['login'], authUrlPattern: 'http', successPatterns: ['ok'], failurePatterns: [] },
      quota: { statuslineInHeadless: false, usageCommand: '/u', creditsCommand: null, usageParser: 'text-v1' },
      catalog: {
        versionArgv: ['--version'],
        modelsArgv: ['models'],
        modelsParser: 'text-v1',
        modes: ['plan'],
      },
    };

    const catalog = new AgyCatalog({ profile: dummyProfile });

    await expect(catalog.listModels()).rejects.toThrowError(AppError);
    try {
      await catalog.listModels();
    } catch (err: any) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('AGY_NOT_INSTALLED');
    }

    // getVersion 返回 null 而不是崩溃
    const ver = await catalog.getVersion();
    expect(ver).toBeNull();
  });

  it('执行失败时抛出 AGY_NOT_INSTALLED AppError', async () => {
    const mockExecutor = async () => {
      throw new Error('Command failed: exit code 1');
    };

    const catalog = new AgyCatalog({
      defaultBin: process.execPath, // 存在的可执行程序
      executor: mockExecutor,
    });

    await expect(catalog.listModels()).rejects.toThrowError(AppError);
    try {
      await catalog.listModels();
    } catch (err: any) {
      expect(err.code).toBe('AGY_NOT_INSTALLED');
    }

    // getVersion 异常捕获后返回 null
    const ver = await catalog.getVersion();
    expect(ver).toBeNull();
  });

  it('使用自定义 executor 成功获取和解析模型', async () => {
    const mockExecutor = async (_bin: string, argv: string[]) => {
      if (argv.includes('models')) {
        return { stdout: modelsTxt, stderr: '' };
      }
      if (argv.includes('--version')) {
        return { stdout: '1.2.12\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };

    const catalog = new AgyCatalog({
      defaultBin: process.execPath,
      executor: mockExecutor,
    });

    const models = await catalog.listModels();
    expect(models).toHaveLength(14);
    expect(models[0].id).toBe('gemini-3.8-flash-high');

    const version = await catalog.getVersion();
    expect(version).toBe('1.2.12');
  });
});
