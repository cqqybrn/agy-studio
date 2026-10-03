import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { AgentMode, Model } from '@agy-studio/contracts';
import { createDatabase, PrefsRepository } from '../../src/repositories/index.js';
import { PrefsService } from '../../src/services/prefs.js';
import { ModelService } from '../../src/services/model.js';
import type { ModelCatalogPort } from '../../src/services/ports/model-catalog.port.js';
import { AppError } from '../../src/utils/errors.js';

describe('ModelService', () => {
  let db: Database.Database;
  let prefsRepo: PrefsRepository;
  let prefsService: PrefsService;
  let mockCatalogPort: ModelCatalogPort;

  const mockModels: Model[] = [
    {
      id: 'gemini-3.8-flash-high',
      label: 'Gemini 3.8 Flash (High)',
      group: 'gemini',
      isDefault: false,
    },
    {
      id: 'gemini-3.8-flash-low',
      label: 'Gemini 3.8 Flash (Low)',
      group: 'gemini',
      isDefault: false,
    },
    {
      id: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6 (Thinking)',
      group: 'third_party',
      isDefault: false,
    },
  ];

  beforeEach(() => {
    db = createDatabase(':memory:');
    prefsRepo = new PrefsRepository(db);
    prefsService = new PrefsService({ prefsRepo });

    mockCatalogPort = {
      listModels: vi.fn().mockResolvedValue([...mockModels]),
      getVersion: vi.fn().mockResolvedValue('1.2.12'),
      listModes: vi.fn().mockResolvedValue(['accept-edits', 'plan'] as AgentMode[]),
    };
  });

  it('10 分钟内存缓存命中：连续多次调用仅触发一次底层 listModels', async () => {
    const modelService = new ModelService({
      catalogPort: mockCatalogPort,
      prefsService,
    });

    const first = await modelService.listModels();
    const second = await modelService.listModels();
    const third = await modelService.listModels();

    expect(mockCatalogPort.listModels).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });

  it('强制刷新：当 refresh === true 时穿透缓存重新获取', async () => {
    const modelService = new ModelService({
      catalogPort: mockCatalogPort,
      prefsService,
    });

    await modelService.listModels();
    expect(mockCatalogPort.listModels).toHaveBeenCalledTimes(1);

    await modelService.listModels({ refresh: true });
    expect(mockCatalogPort.listModels).toHaveBeenCalledTimes(2);

    await modelService.listModels({ refresh: false });
    expect(mockCatalogPort.listModels).toHaveBeenCalledTimes(2);
  });

  it('isDefault 关联：未设置默认模型时，首个 gemini 模型为 isDefault', async () => {
    const modelService = new ModelService({
      catalogPort: mockCatalogPort,
      prefsService,
    });

    const models = await modelService.listModels();
    const defaultModel = models.find((m) => m.isDefault);

    expect(defaultModel).toBeDefined();
    expect(defaultModel?.id).toBe('gemini-3.8-flash-high');
    expect(models.filter((m) => m.isDefault)).toHaveLength(1);
  });

  it('isDefault 关联：若配置了 prefs.defaultModel，匹配对应模型', async () => {
    await prefsService.updatePrefs({ defaultModel: 'claude-sonnet-4-6' });

    const modelService = new ModelService({
      catalogPort: mockCatalogPort,
      prefsService,
    });

    const models = await modelService.listModels();
    const defaultModel = models.find((m) => m.isDefault);

    expect(defaultModel?.id).toBe('claude-sonnet-4-6');
    expect(models.find((m) => m.id === 'gemini-3.8-flash-high')?.isDefault).toBe(false);
  });

  it('isDefault 关联：若未设置默认且无 gemini 模型，首个模型为 isDefault', async () => {
    const thirdPartyOnly: Model[] = [
      { id: 'claude-sonnet-4-6', label: 'Claude', group: 'third_party', isDefault: false },
      { id: 'gpt-oss-120b', label: 'GPT', group: 'third_party', isDefault: false },
    ];
    mockCatalogPort.listModels = vi.fn().mockResolvedValue(thirdPartyOnly);

    const modelService = new ModelService({
      catalogPort: mockCatalogPort,
      prefsService,
    });

    const models = await modelService.listModels();
    expect(models[0].isDefault).toBe(true);
    expect(models[1].isDefault).toBe(false);
  });

  it('isDefault 关联：模型列表为空时安全返回空数组', async () => {
    mockCatalogPort.listModels = vi.fn().mockResolvedValue([]);

    const modelService = new ModelService({
      catalogPort: mockCatalogPort,
      prefsService,
    });

    const models = await modelService.listModels();
    expect(models).toEqual([]);
  });

  it('若 catalogPort 抛出或检测到 agy 未安装，向上抛出 AppError(AGY_NOT_INSTALLED)', async () => {
    mockCatalogPort.listModels = vi.fn().mockRejectedValue(new AppError('AGY_NOT_INSTALLED', 'Agy not installed'));

    const modelService = new ModelService({
      catalogPort: mockCatalogPort,
      prefsService,
    });

    await expect(modelService.listModels()).rejects.toThrowError(AppError);
    try {
      await modelService.listModels();
    } catch (err: any) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('AGY_NOT_INSTALLED');
    }
  });

  it('若 catalogPort 抛出普通 Error，依然包装为 AGY_NOT_INSTALLED', async () => {
    mockCatalogPort.listModels = vi.fn().mockRejectedValue(new Error('Process spawn failed'));

    const modelService = new ModelService({
      catalogPort: mockCatalogPort,
      prefsService,
    });

    await expect(modelService.listModels()).rejects.toThrowError(AppError);
    try {
      await modelService.listModels();
    } catch (err: any) {
      expect(err.code).toBe('AGY_NOT_INSTALLED');
    }
  });

  it('catalog 失败时回退到磁盘缓存而不是报错', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-models-'));
    fs.writeFileSync(
      path.join(dataDir, 'models-cache.json'),
      JSON.stringify({ models: mockModels }),
    );
    mockCatalogPort.listModels = vi
      .fn()
      .mockRejectedValue(new AppError('AGY_NOT_AUTHENTICATED', 'Please sign in'));

    const modelService = new ModelService({
      catalogPort: mockCatalogPort,
      prefsService,
      config: { host: '127.0.0.1', port: 8790, dataDir },
    });

    const models = await modelService.listModels();
    expect(mockCatalogPort.listModels).not.toHaveBeenCalled();
    expect(models.map((m) => m.id)).toEqual(mockModels.map((m) => m.id));
  });

  it('刷新前调用 ensureCredentials，再拉取模型列表', async () => {
    const ensureCredentials = vi.fn().mockResolvedValue(undefined);

    const modelService = new ModelService({
      catalogPort: mockCatalogPort,
      prefsService,
      ensureCredentials,
    });

    const models = await modelService.listModels();
    expect(ensureCredentials).toHaveBeenCalledTimes(1);
    expect(mockCatalogPort.listModels).toHaveBeenCalledTimes(1);
    expect(models.map((m) => m.id)).toEqual(mockModels.map((m) => m.id));
  });
});
