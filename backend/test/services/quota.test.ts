import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, EventsRepository } from '../../src/repositories/index.js';
import { QuotaCacheRepository } from '../../src/repositories/quota-cache.js';
import { QuotaService } from '../../src/services/quota.js';
import { EventBus } from '../../src/services/event-bus.js';
import { AccountLeaseLock } from '../../src/services/account/lease-lock.js';
import type { QuotaProbePort } from '../../src/services/ports/quota-probe.port.js';
import type { QuotaSnapshot } from '@agy-studio/contracts';
import { AppError } from '../../src/utils/errors.js';
import type { Logger } from 'pino';

describe('QuotaService', () => {
  let db: Database.Database;
  let quotaCacheRepo: QuotaCacheRepository;
  let eventsRepo: EventsRepository;
  let eventBus: EventBus;
  let leaseLock: AccountLeaseLock;
  let mockProbe: QuotaProbePort;
  let currentTime: number;

  const mockSnapshot: QuotaSnapshot = {
    source: 'quota_api',
    accountName: 'acc-1',
    email: 'acc1@example.com',
    planTier: 'Google AI Pro',
    title: 'Model Quotas',
    description: 'Quota limits description',
    groups: [
      {
        displayName: 'Gemini Models',
        description: 'Gemini models',
        buckets: [
          {
            bucketId: 'gemini-weekly',
            displayName: 'Weekly Limit Remaining',
            window: 'weekly',
            remainingFraction: 0.95,
            resetTime: '2026-10-05T14:07:13Z',
            resetInSeconds: 5000,
            description: 'Weekly reset',
            disabled: false,
          },
        ],
      },
    ],
    credits: { available: false, balance: null },
    fetchedAt: '2026-09-28T18:50:41.565Z',
    cached: false,
    stale: false,
  };

  beforeEach(() => {
    db = createDatabase(':memory:');
    quotaCacheRepo = new QuotaCacheRepository(db);
    eventsRepo = new EventsRepository(db);
    eventBus = new EventBus({ eventsRepo });
    leaseLock = new AccountLeaseLock();
    currentTime = new Date('2026-09-28T18:50:41.565Z').getTime();

    mockProbe = {
      probe: vi.fn().mockResolvedValue({ ...mockSnapshot }),
    };
  });

  afterEach(() => {
    db.close();
  });

  const createService = (options: {
    rateLimitMs?: number;
    logger?: Logger;
  } = {}) => {
    return new QuotaService({
      quotaCacheRepo,
      quotaProbe: mockProbe,
      leaseLock,
      eventBus,
      rateLimitMs: options.rateLimitMs ?? 60_000,
      clock: () => new Date(currentTime),
      logger: options.logger,
    });
  };

  describe('Rate Limiting & Caching', () => {
    it('fetches on first call and caches snapshot in repo', async () => {
      const service = createService();
      const snapshot = await service.get('acc-1');

      expect(snapshot.source).toBe('quota_api');
      expect(snapshot.cached).toBe(false);
      expect(mockProbe.probe).toHaveBeenCalledTimes(1);

      // Verify stored in DB
      const dbRecord = quotaCacheRepo.get('acc-1', 'quota_api');
      expect(dbRecord).not.toBeNull();
      expect(dbRecord?.snapshot.groups.length).toBe(1);
    });

    it('returns cached snapshot if called again within 1 minute', async () => {
      const service = createService();
      await service.get('acc-1');
      expect(mockProbe.probe).toHaveBeenCalledTimes(1);

      // Advance clock by 30 seconds (within 1 min)
      currentTime += 30_000;

      const second = await service.get('acc-1');
      expect(second.cached).toBe(true);
      expect(mockProbe.probe).toHaveBeenCalledTimes(1);
    });

    it('fetches anew once rate limit interval has passed', async () => {
      const service = createService();
      await service.get('acc-1');
      expect(mockProbe.probe).toHaveBeenCalledTimes(1);

      // Advance clock by 61 seconds
      currentTime += 61_000;

      const second = await service.get('acc-1');
      expect(second.cached).toBe(false);
      expect(mockProbe.probe).toHaveBeenCalledTimes(2);
    });

    it('bypasses cache when refresh is true even within 1 minute', async () => {
      const service = createService();
      await service.get('acc-1');
      expect(mockProbe.probe).toHaveBeenCalledTimes(1);

      currentTime += 10_000;

      const refreshed = await service.get('acc-1', true);
      expect(refreshed.cached).toBe(false);
      expect(mockProbe.probe).toHaveBeenCalledTimes(2);
    });
  });

  describe('Concurrency Deduplication', () => {
    it('merges simultaneous requests for the same account into a single probe call', async () => {
      let probeResolver: (v: QuotaSnapshot) => void;
      mockProbe.probe = vi.fn().mockImplementation(() => {
        return new Promise<QuotaSnapshot>((resolve) => {
          probeResolver = resolve;
        });
      });

      const service = createService();

      const p1 = service.get('acc-1');
      const p2 = service.get('acc-1');
      const p3 = service.get('acc-1');

      // Resolve probe
      probeResolver!(mockSnapshot);

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      expect(mockProbe.probe).toHaveBeenCalledTimes(1);
      expect(r1.groups.length).toBe(1);
      expect(r2.groups.length).toBe(1);
      expect(r3.groups.length).toBe(1);
    });
  });

  describe('Failure Handling: Stale & Unavailable', () => {
    it('returns stale cache when probe fails after previously succeeding', async () => {
      const service = createService();
      // First call succeeds
      await service.get('acc-1');

      // Probe now fails
      mockProbe.probe = vi.fn().mockRejectedValue(new Error('Network error'));
      currentTime += 70_000;

      const failedCall = await service.get('acc-1');
      expect(failedCall.source).toBe('quota_api');
      expect(failedCall.cached).toBe(true);
      expect(failedCall.stale).toBe(true);
      expect(failedCall.groups.length).toBe(1);
    });

    it('returns source: unavailable and empty groups when probe fails and no cache exists', async () => {
      mockProbe.probe = vi.fn().mockRejectedValue(new Error('No live credentials found; log in to agy first'));
      const service = createService();

      const result = await service.get('fresh-acc');
      expect(result.source).toBe('unavailable');
      expect(result.stale).toBe(false);
      expect(result.groups).toEqual([]);
      expect(result.accountName).toBe('fresh-acc');
      expect(result.description).toContain('未登录或凭据已失效');
    });
  });

  describe('Read Lease Lock Fallback', () => {
    it('returns stale cache if read lease cannot be acquired and cache exists', async () => {
      const service = createService();
      await service.get('acc-1');

      // Hold write lease (e.g. account switch in progress)
      const writeLease = leaseLock.acquireWriteLease();

      try {
        const result = await service.get('acc-1', true);
        expect(result.stale).toBe(true);
        expect(result.cached).toBe(true);
        expect(result.groups.length).toBe(1);
      } finally {
        writeLease.release();
      }
    });

    it('returns unavailable if read lease cannot be acquired and no cache exists', async () => {
      const service = createService();
      const writeLease = leaseLock.acquireWriteLease();

      try {
        const result = await service.get('uncached-acc');
        expect(result.source).toBe('unavailable');
        expect(result.stale).toBe(false);
        expect(result.groups).toEqual([]);
      } finally {
        writeLease.release();
      }
    });
  });

  describe('Account Switch Invalidation & Late Result Dropping', () => {
    it('invalidates cache when account.changed event is received', async () => {
      const service = createService();
      await service.get('acc-1');
      expect(quotaCacheRepo.get('acc-1', 'quota_api')).not.toBeNull();

      // Trigger account.changed
      eventBus.publishGlobal({
        type: 'account.changed',
        whoami: {
          activeProfile: 'acc-1',
          email: 'acc1@example.com',
          accountType: 'oauth',
          isolation: 'credential_snapshot',
          credentialPresent: true,
        },
      });

      expect(quotaCacheRepo.get('acc-1', 'quota_api')).toBeNull();
    });

    it('drops late probe result if account was changed while probe was in-flight', async () => {
      let probeResolver: (v: QuotaSnapshot) => void;
      mockProbe.probe = vi.fn().mockImplementation(() => {
        return new Promise<QuotaSnapshot>((resolve) => {
          probeResolver = resolve;
        });
      });

      const publishedEvents: unknown[] = [];
      eventBus.subscribeGlobal((ev) => {
        if (ev.type === 'quota.updated') publishedEvents.push(ev);
      });

      const service = createService();

      // Start in-flight request
      const pendingGet = service.get('acc-1');

      // Simulate account switch during probe
      eventBus.publishGlobal({
        type: 'account.changed',
        whoami: {
          activeProfile: 'acc-2',
          email: 'acc2@example.com',
          accountType: 'oauth',
          isolation: 'credential_snapshot',
          credentialPresent: true,
        },
      });

      // Finish the slow probe
      probeResolver!(mockSnapshot);

      const result = await pendingGet;

      // Result should be dropped / unavailable, NOT stored in cache, and NOT published
      expect(result.source).toBe('unavailable');
      expect(publishedEvents.length).toBe(0);
      expect(quotaCacheRepo.get('acc-1', 'quota_api')).toBeNull();
    });

    it('publishes quota.updated global event on successful probe', async () => {
      const publishedEvents: unknown[] = [];
      eventBus.subscribeGlobal((ev) => {
        if (ev.type === 'quota.updated') publishedEvents.push(ev);
      });

      const service = createService();
      await service.get('acc-1');

      expect(publishedEvents.length).toBe(1);
      expect((publishedEvents[0] as { type: string }).type).toBe('quota.updated');
    });
  });

  describe('Security & Sensitive Data Redaction in Logs', () => {
    it('ensures tokens and secrets are never leaked to logs on errors', async () => {
      const loggedMessages: string[] = [];
      const testLogger = {
        warn: vi.fn().mockImplementation((obj: Record<string, unknown>, msg?: string) => {
          loggedMessages.push(JSON.stringify(obj) + ' ' + (msg ?? ''));
        }),
        debug: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
      } as unknown as Logger;

      const sensitiveRefreshToken = '1//secret-refresh-token-12345';
      const sensitiveAccessToken = 'ya29.secret-access-token-98765';
      const sensitiveSecret = 'GOCSPX-secretsecretsecret12345';

      mockProbe.probe = vi.fn().mockRejectedValue(
        new Error(
          `Failed request with auth token: ${sensitiveAccessToken}, refresh: ${sensitiveRefreshToken}, secret: ${sensitiveSecret}`,
        ),
      );

      const service = createService({ logger: testLogger });
      await service.get('acc-1');

      const allLogs = loggedMessages.join('\n');
      expect(allLogs).not.toContain(sensitiveRefreshToken);
      expect(allLogs).not.toContain(sensitiveAccessToken);
      expect(allLogs).not.toContain(sensitiveSecret);
      expect(allLogs).toContain('<redacted:access_token>');
      expect(allLogs).toContain('<redacted:refresh_token>');
      expect(allLogs).toContain('<redacted:client_secret>');
    });
  });
});
