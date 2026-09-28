import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { QuotaSnapshot } from '@agy-studio/contracts';
import { quotaRoutes } from '../../src/routes/http/quota.routes.js';
import type { QuotaService } from '../../src/services/quota.js';
import { AppError } from '../../src/utils/errors.js';

describe('Quota HTTP Routes', () => {
  let app: FastifyInstance;
  let mockQuotaService: QuotaService;

  const mockSnapshot: QuotaSnapshot = {
    source: 'quota_api',
    accountName: 'test-acc',
    email: 'test@example.com',
    planTier: 'Google AI Pro',
    title: 'Model Quotas',
    description: null,
    groups: [],
    credits: { available: false, balance: null },
    fetchedAt: '2026-09-28T18:50:41.565Z',
    cached: false,
    stale: false,
  };

  beforeEach(async () => {
    mockQuotaService = {
      get: vi.fn().mockResolvedValue(mockSnapshot),
    } as unknown as QuotaService;

    app = Fastify();
    await app.register(quotaRoutes, { quotaService: mockQuotaService });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/quota returns 200 with snapshot and default arguments', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/quota',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe('Model Quotas');
    expect(body.source).toBe('quota_api');
    expect(mockQuotaService.get).toHaveBeenCalledWith(undefined, undefined);
  });

  it('GET /api/quota with account query param passes account to service', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/quota?account=custom-acc',
    });

    expect(res.statusCode).toBe(200);
    expect(mockQuotaService.get).toHaveBeenCalledWith('custom-acc', undefined);
  });

  it('GET /api/quota with refresh=true parses boolean and passes to service', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/quota?account=custom-acc&refresh=true',
    });

    expect(res.statusCode).toBe(200);
    expect(mockQuotaService.get).toHaveBeenCalledWith('custom-acc', true);
  });

  it('GET /api/quota with refresh=false parses boolean false', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/quota?refresh=false',
    });

    expect(res.statusCode).toBe(200);
    expect(mockQuotaService.get).toHaveBeenCalledWith(undefined, false);
  });

  it('maps AppError correctly to status code and ApiErrorBody', async () => {
    mockQuotaService.get = vi.fn().mockRejectedValue(
      new AppError('QUOTA_FETCH_FAILED', 'Failed to retrieve quota'),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/quota',
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error.code).toBe('QUOTA_FETCH_FAILED');
    expect(body.error.message).toBe('Failed to retrieve quota');
  });
});
