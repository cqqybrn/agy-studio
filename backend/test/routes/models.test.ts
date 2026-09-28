import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { Model } from '@agy-studio/contracts';
import { createDatabase, PrefsRepository } from '../../src/repositories/index.js';
import { PrefsService } from '../../src/services/prefs.js';
import { ModelService } from '../../src/services/model.js';
import type { ModelCatalogPort } from '../../src/services/ports/model-catalog.port.js';
import { modelsRoutes } from '../../src/routes/http/models.routes.js';
import { AppError } from '../../src/utils/errors.js';

describe('Models HTTP Routes', () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let prefsRepo: PrefsRepository;
  let prefsService: PrefsService;
  let mockCatalogPort: ModelCatalogPort;
  let modelService: ModelService;

  const mockModels: Model[] = [
    {
      id: 'gemini-3.8-flash-high',
      label: 'Gemini 3.8 Flash (High)',
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

  beforeEach(async () => {
    db = createDatabase(':memory:');
    prefsRepo = new PrefsRepository(db);
    prefsService = new PrefsService({ prefsRepo });

    mockCatalogPort = {
      listModels: vi.fn().mockResolvedValue([...mockModels]),
      getVersion: vi.fn().mockResolvedValue('1.2.12'),
      listModes: vi.fn().mockResolvedValue(['accept-edits', 'plan']),
    };

    modelService = new ModelService({
      catalogPort: mockCatalogPort,
      prefsService,
    });

    app = Fastify();
    await app.register(modelsRoutes, { modelService });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('GET /api/models returns 200 with list of models and computed isDefault', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/models',
    });

    expect(res.statusCode).toBe(200);
    const body: Model[] = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('gemini-3.8-flash-high');
    expect(body[0].isDefault).toBe(true);
    expect(body[1].id).toBe('claude-sonnet-4-6');
    expect(body[1].isDefault).toBe(false);
  });

  it('GET /api/models?refresh=true triggers refresh', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/models?refresh=true',
    });

    expect(res.statusCode).toBe(200);
    expect(mockCatalogPort.listModels).toHaveBeenCalledTimes(1);
  });

  it('GET /api/models returns 503 AGY_NOT_INSTALLED when agy is not installed', async () => {
    mockCatalogPort.listModels = vi.fn().mockRejectedValue(
      new AppError('AGY_NOT_INSTALLED', 'Agy CLI is not installed'),
    );
    // Clear cache so it hits catalogPort
    modelService.clearCache();

    const res = await app.inject({
      method: 'GET',
      url: '/api/models',
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('AGY_NOT_INSTALLED');
  });
});
