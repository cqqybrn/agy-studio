import type { QuotaSnapshot } from '@agy-studio/contracts';
import type { QuotaCacheRepository } from '../repositories/quota-cache.js';
import type { AccountsRepository } from '../repositories/accounts.js';
import type { QuotaProbePort } from './ports/quota-probe.port.js';
import type { AccountLeaseLock } from './account/lease-lock.js';
import type { EventBus } from './event-bus.js';
import type { Logger } from 'pino';
import { logger as defaultLogger } from '../utils/logger.js';
import { redactSecrets } from '../utils/redact.js';

export interface QuotaServiceOptions {
  quotaCacheRepo: QuotaCacheRepository;
  quotaProbe: QuotaProbePort;
  leaseLock: AccountLeaseLock;
  eventBus: EventBus;
  accountsRepo?: AccountsRepository;
  rateLimitMs?: number;
  logger?: Logger;
  clock?: () => Date;
}

export class QuotaService {
  private readonly quotaCacheRepo: QuotaCacheRepository;
  private readonly quotaProbe: QuotaProbePort;
  private readonly leaseLock: AccountLeaseLock;
  private readonly eventBus: EventBus;
  private readonly accountsRepo?: AccountsRepository;
  private readonly rateLimitMs: number;
  private readonly logger: Logger;
  private readonly clock: () => Date;

  private readonly inFlightRequests = new Map<string, Promise<QuotaSnapshot>>();
  private readonly accountGenerations = new Map<string, number>();
  private globalGeneration = 0;
  private readonly unsubscribeGlobal: () => void;

  constructor(options: QuotaServiceOptions) {
    this.quotaCacheRepo = options.quotaCacheRepo;
    this.quotaProbe = options.quotaProbe;
    this.leaseLock = options.leaseLock;
    this.eventBus = options.eventBus;
    this.accountsRepo = options.accountsRepo;
    this.rateLimitMs = options.rateLimitMs ?? 60_000;
    this.logger = options.logger ?? defaultLogger;
    this.clock = options.clock ?? (() => new Date());

    this.unsubscribeGlobal = this.eventBus.subscribeGlobal((event) => {
      if (event.type === 'account.changed') {
        this.invalidateOnAccountChanged(event.whoami?.activeProfile ?? null);
      }
    });
  }

  dispose(): void {
    this.unsubscribeGlobal();
  }

  private now(): Date {
    return this.clock();
  }

  private getAccountGeneration(accountKey: string): number {
    return (this.accountGenerations.get(accountKey) ?? 0) + this.globalGeneration;
  }

  private invalidateOnAccountChanged(accountName: string | null): void {
    this.globalGeneration += 1;
    if (accountName) {
      const current = this.accountGenerations.get(accountName) ?? 0;
      this.accountGenerations.set(accountName, current + 1);
      this.quotaCacheRepo.deleteByAccount(accountName);
    }
    this.quotaCacheRepo.deleteByAccount('__default__');
    this.logger.debug({ accountName }, 'Invalidated quota cache due to account.changed');
  }

  private createUnavailableSnapshot(
    accountName: string | null,
    description: string | null = null,
  ): QuotaSnapshot {
    return {
      source: 'unavailable',
      accountName,
      email: null,
      planTier: null,
      title: 'Model Quotas',
      description,
      groups: [],
      credits: { available: false, balance: null },
      fetchedAt: this.now().toISOString(),
      cached: false,
      stale: false,
    };
  }

  private describeProbeFailure(err: unknown): string {
    const safeMsg = redactSecrets((err as Error).message ?? String(err));
    if (/timed out/i.test(safeMsg)) {
      return '查询超时：无法在限定时间内连上 Google 额度接口，请检查网络后重试';
    }
    if (/not authenticated|log in|sign in|no live credentials|no refresh token/i.test(safeMsg)) {
      return '未登录或凭据已失效，请到账号页重新登录后再查额度';
    }
    return safeMsg || '额度接口暂不可用';
  }

  async get(accountName?: string, refresh?: boolean): Promise<QuotaSnapshot> {
    const targetAccount = accountName ?? this.accountsRepo?.findDefault()?.name ?? null;
    const cacheKey = targetAccount ?? '__default__';

    // 1. Rate limiting check: if not forced refresh, return cache if fetched within 1 minute
    const cachedRecord = this.quotaCacheRepo.get(cacheKey, 'quota_api');
    if (!refresh && cachedRecord) {
      const nowMs = this.now().getTime();
      const fetchedAtMs = new Date(cachedRecord.fetchedAt).getTime();
      if (!Number.isNaN(fetchedAtMs) && nowMs - fetchedAtMs < this.rateLimitMs) {
        return {
          ...cachedRecord.snapshot,
          cached: true,
        };
      }
    }

    // 2. Concurrency deduplication: merge in-flight queries for same account
    const inFlight = this.inFlightRequests.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const fetchPromise = this.executeFetch(targetAccount, cacheKey);
    this.inFlightRequests.set(cacheKey, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      this.inFlightRequests.delete(cacheKey);
    }
  }

  private async executeFetch(
    targetAccount: string | null,
    cacheKey: string,
  ): Promise<QuotaSnapshot> {
    const startGeneration = this.getAccountGeneration(cacheKey);

    // 3. Acquire read lease before reading credentials
    const lease = this.leaseLock.tryRead();
    if (!lease) {
      // Lease unavailable (e.g. account switch in progress): return cached with stale=true, or unavailable
      const cached = this.quotaCacheRepo.get(cacheKey, 'quota_api');
      if (cached) {
        return {
          ...cached.snapshot,
          cached: true,
          stale: true,
        };
      }
      return this.createUnavailableSnapshot(targetAccount, '账号正在切换，暂时无法读取额度凭据');
    }

    let probeResult: QuotaSnapshot | null = null;
    let probeError: unknown;
    try {
      probeResult = await this.quotaProbe.probe(targetAccount);
    } catch (err: unknown) {
      probeError = err;
      const safeMsg = redactSecrets((err as Error).message);
      this.logger.warn({ err: safeMsg, account: targetAccount }, 'Quota probe failed');
    } finally {
      lease.release();
    }

    // 4. Late arrival check: if account was changed/invalidated during probe, drop the result
    const currentGeneration = this.getAccountGeneration(cacheKey);
    if (currentGeneration !== startGeneration) {
      this.logger.debug(
        { account: targetAccount },
        'Discarded late quota probe result due to account switch/invalidation',
      );
      const currentCache = this.quotaCacheRepo.get(cacheKey, 'quota_api');
      return currentCache
        ? { ...currentCache.snapshot, cached: true }
        : this.createUnavailableSnapshot(targetAccount);
    }

    // 5. If probe succeeded, write to cache and publish global event
    if (probeResult) {
      const snapshot: QuotaSnapshot = {
        ...probeResult,
        accountName: targetAccount,
        fetchedAt: this.now().toISOString(),
        cached: false,
        stale: false,
      };

      this.quotaCacheRepo.set(cacheKey, 'quota_api', snapshot);
      this.eventBus.publishGlobal({
        type: 'quota.updated',
        snapshot,
      });

      return snapshot;
    }

    // 6. If probe failed: return cached data with stale: true, or unavailable
    const cached = this.quotaCacheRepo.get(cacheKey, 'quota_api');
    if (cached) {
      return {
        ...cached.snapshot,
        cached: true,
        stale: true,
      };
    }

    return this.createUnavailableSnapshot(
      targetAccount,
      probeError ? this.describeProbeFailure(probeError) : null,
    );
  }
}
