import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { Prefs } from '@agy-studio/contracts';
import { createDatabase, PrefsRepository } from '../../src/repositories/index.js';
import { PrefsService } from '../../src/services/prefs.js';
import { prefsRoutes } from '../../src/routes/http/prefs.routes.js';

describe('Prefs HTTP Routes', () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let prefsRepo: PrefsRepository;
  let prefsService: PrefsService;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    prefsRepo = new PrefsRepository(db);
    prefsService = new PrefsService({ prefsRepo });

    app = Fastify();
    await app.register(prefsRoutes, { prefsService });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('GET /api/prefs returns default prefs with 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/prefs',
    });

    expect(res.statusCode).toBe(200);
    const body: Prefs = JSON.parse(res.body);
    expect(body.showThinking).toBe(true);
    expect(body.checkpointsEnabled).toBe(true);
    expect(body.maxConcurrentRuns).toBe(3);
    expect(body.stallTimeoutSeconds).toBe(180);
    expect(body.defaultModel).toBeNull();
    expect(body.defaultEffort).toBeNull();
    expect(body.defaultMode).toBeNull();
    expect(body.defaultWorkspaceId).toBeNull();
  });

  it('PUT /api/prefs updates prefs and returns updated object', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/prefs',
      payload: {
        defaultModel: 'gemini-3.8-flash-high',
        defaultEffort: 'medium',
        showThinking: false,
        maxConcurrentRuns: 5,
      },
    });

    expect(res.statusCode).toBe(200);
    const body: Prefs = JSON.parse(res.body);
    expect(body.defaultModel).toBe('gemini-3.8-flash-high');
    expect(body.defaultEffort).toBe('medium');
    expect(body.showThinking).toBe(false);
    expect(body.maxConcurrentRuns).toBe(5);

    // 验证随后的 GET 读取到相同结果
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/prefs',
    });
    expect(JSON.parse(getRes.body)).toEqual(body);
  });

  it('PUT /api/prefs validates body schema and returns 400 BAD_REQUEST on invalid values', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/prefs',
      payload: {
        defaultEffort: 'invalid-effort-value', // 不在 low, medium, high, max 范围内
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('BAD_REQUEST');
  });
});
