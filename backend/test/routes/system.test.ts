import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { Capabilities, Health } from '@agy-studio/contracts';
import { createDatabase, AccountsRepository } from '../../src/repositories/index.js';
import type { ModelCatalogPort } from '../../src/services/ports/model-catalog.port.js';
import type { AgyProfile } from '../../src/integrations/agy/profile/schema.js';
import { systemRoutes, deriveCapabilitiesFeatures } from '../../src/routes/http/system.routes.js';

describe('System HTTP Routes', () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let accountsRepo: AccountsRepository;
  let mockCatalogPort: ModelCatalogPort;

  const mockProfile: AgyProfile = {
    agyVersion: '1.2.12',
    discoveredAt: '2026-09-28T00:00:00.000Z',
    binary: { candidates: ['agy', 'agy.exe'] },
    stream: {
      userFrameTemplate: '{{prompt}}',
      multiTurnStdin: false,
      eventTypeMap: {
        init: 'init',
        step_update: 'step_update',
        result: 'result',
      },
      permissionEvent: null,
      imageInput: { supported: false, template: null },
    },
    paths: {
      dataRoots: ['/dummy'],
      conversationDirPattern: '/dummy/{{conversationId}}',
      transcriptRelPath: '.system_generated/logs/transcript.jsonl',
    },
    settings: {
      files: [{ scope: 'user', pathTemplate: '/dummy/settings.json' }],
      alwaysProceed: { jsonPath: 'alwaysProceed', value: true },
      statusline: { jsonPath: 'statusline' },
    },
    credentials: {
      preferredIsolation: 'isolated_home',
      homeEnvVars: ['USERPROFILE'],
      wincredTargetPatterns: [],
      credentialFiles: [],
    },
    login: {
      argv: ['login'],
      authUrlPattern: 'https?://',
      successPatterns: ['Logged in as'],
      failurePatterns: ['Error'],
    },
    quota: {
      statuslineInHeadless: false,
      usageCommand: '/usage',
      creditsCommand: '/credits',
      usageParser: 'text-v1',
    },
    catalog: {
      versionArgv: ['--version'],
      modelsArgv: ['models'],
      modelsParser: 'text-v1',
      modes: ['accept-edits', 'plan'],
    },
  };

  beforeEach(() => {
    db = createDatabase(':memory:');
    accountsRepo = new AccountsRepository(db);

    mockCatalogPort = {
      listModels: vi.fn().mockResolvedValue([]),
      getVersion: vi.fn().mockResolvedValue('1.2.12'),
      listModes: vi.fn().mockResolvedValue(['accept-edits', 'plan']),
    };
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    db.close();
  });

  it('GET /api/health 返回健康信息，默认无活跃账号', async () => {
    app = Fastify();
    await app.register(systemRoutes, {
      catalogPort: mockCatalogPort,
      profile: mockProfile,
      accountsRepo,
      supervisor: { activeRuns: () => [] },
      startTime: Date.now() - 5000,
      version: '0.1.0',
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(res.statusCode).toBe(200);
    const body: Health = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.version).toBe('0.1.0');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(5);
    expect(body.activeRuns).toBe(0);
    expect(body.account).toEqual({
      activeProfile: null,
      email: null,
      accountType: null,
      isolation: null,
      credentialPresent: false,
      name: null,
    });
  });

  it('GET /api/health 返回当前活跃账号信息与 activeRuns 数量', async () => {
    accountsRepo.save({
      name: 'Torres72',
      type: 'oauth',
      isolation: 'isolated_home',
      email: 'torres@example.com',
      note: 'Main account',
      savedAt: new Date().toISOString(),
      active: true,
    });

    app = Fastify();
    await app.register(systemRoutes, {
      catalogPort: mockCatalogPort,
      profile: mockProfile,
      accountsRepo,
      supervisor: { activeRuns: () => [{}, {}] }, // 2 active runs
      version: '0.1.0',
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(res.statusCode).toBe(200);
    const body: Health = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.activeRuns).toBe(2);
    expect((body.account as any).name).toBe('Torres72');
    expect(body.account.activeProfile).toBe('Torres72');
    expect(body.account.email).toBe('torres@example.com');
    expect(body.account.credentialPresent).toBe(true);
  });

  it('GET /api/capabilities 正常返回检测到的 agy 路径与特性', async () => {
    app = Fastify();
    await app.register(systemRoutes, {
      catalogPort: mockCatalogPort,
      profile: mockProfile,
      binFinder: () => 'G:/dummy/agy.exe',
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
    });

    expect(res.statusCode).toBe(200);
    const body: Capabilities = JSON.parse(res.body);
    expect(body.agyPath).toBe('G:/dummy/agy.exe');
    expect(body.agyVersion).toBe('1.2.12');
    expect(body.profileAgyVersion).toBe('1.2.12');
    expect(body.autoApprove).toBe(true);
    expect(body.modes).toEqual(['accept-edits', 'plan']);
    expect(body.features).toEqual({
      mainThinkingStream: false,
      multiTurnStdin: false,
      nativeImageInput: false,
      permissionEvents: false,
      statuslineQuota: false,
      cliUsageProbe: true,
      credits: true,
      isolatedHomes: true,
      concurrentAccounts: true,
    });
  });

  it('GET /api/capabilities 未安装 agy 时降级为 agyPath=null, agyVersion=null 且绝不返回 500', async () => {
    mockCatalogPort.getVersion = vi.fn().mockRejectedValue(new Error('ENOENT: command not found'));

    app = Fastify();
    await app.register(systemRoutes, {
      catalogPort: mockCatalogPort,
      profile: mockProfile,
      binFinder: () => null, // 未找到可执行文件
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
    });

    expect(res.statusCode).toBe(200);
    const body: Capabilities = JSON.parse(res.body);
    expect(body.agyPath).toBeNull();
    expect(body.agyVersion).toBeNull();
    expect(body.profileAgyVersion).toBe('1.2.12');
    expect(body.autoApprove).toBe(true);
  });

  it('deriveCapabilitiesFeatures 能正确从 profile 计算各项特性', () => {
    const fullFeaturesProfile: AgyProfile = {
      ...mockProfile,
      stream: {
        ...mockProfile.stream,
        multiTurnStdin: true,
        eventTypeMap: {
          thinking: 'thinking_delta',
        },
        imageInput: { supported: true, template: '<img />' },
        permissionEvent: { match: {}, replyTemplate: 'ok' },
      },
      quota: {
        ...mockProfile.quota,
        statuslineInHeadless: true,
        usageCommand: '/usage',
        creditsCommand: '/credits',
      },
      credentials: {
        ...mockProfile.credentials,
        preferredIsolation: 'credential_snapshot',
      },
    };

    const features = deriveCapabilitiesFeatures(fullFeaturesProfile);
    expect(features.mainThinkingStream).toBe(true);
    expect(features.multiTurnStdin).toBe(true);
    expect(features.nativeImageInput).toBe(true);
    expect(features.permissionEvents).toBe(true);
    expect(features.statuslineQuota).toBe(true);
    expect(features.cliUsageProbe).toBe(true);
    expect(features.credits).toBe(true);
    expect(features.isolatedHomes).toBe(false);
    expect(features.concurrentAccounts).toBe(false);
  });
});
