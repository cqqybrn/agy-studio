import type {
  QuotaBucket,
  QuotaGroup,
  QuotaSnapshot,
  QuotaWindow,
} from '@agy-studio/contracts';
import type { QuotaProbePort } from '../../services/ports/quota-probe.port.js';
import type { CredentialStore } from './credential-store.js';
import { parseJwtPayload } from './credential-store.js';
import type { OAuthClientManager } from './oauth-client.js';
import type { AgyProfile } from './profile/schema.js';
import { AppError } from '../../utils/errors.js';
import { redactSecrets } from '../../utils/redact.js';
import type { Logger } from 'pino';

export interface ParseQuotaSummaryOptions {
  accountName?: string | null;
  email?: string | null;
  planTier?: string | null;
  fetchedAt?: string;
  now?: Date;
}

export function parseQuotaSummaryResponse(
  body: unknown,
  options?: ParseQuotaSummaryOptions,
): QuotaSnapshot | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.groups)) {
    return null;
  }

  const now = options?.now ?? new Date();
  const parsedGroups: QuotaGroup[] = [];

  for (const groupItem of record.groups) {
    if (!groupItem || typeof groupItem !== 'object') {
      return null;
    }
    const groupRecord = groupItem as Record<string, unknown>;
    if (typeof groupRecord.displayName !== 'string' || !groupRecord.displayName.trim()) {
      return null;
    }
    if (!Array.isArray(groupRecord.buckets)) {
      return null;
    }

    const groupDescription =
      typeof groupRecord.description === 'string' ? groupRecord.description : null;

    const parsedBuckets: QuotaBucket[] = [];

    for (const bucketItem of groupRecord.buckets) {
      if (!bucketItem || typeof bucketItem !== 'object') {
        return null;
      }
      const bRecord = bucketItem as Record<string, unknown>;

      if (typeof bRecord.bucketId !== 'string' || !bRecord.bucketId.trim()) {
        return null;
      }
      if (typeof bRecord.displayName !== 'string' || !bRecord.displayName.trim()) {
        return null;
      }
      if (typeof bRecord.remainingFraction !== 'number' || Number.isNaN(bRecord.remainingFraction)) {
        return null;
      }
      if (typeof bRecord.window !== 'string') {
        return null;
      }

      let resetTime: string | null = null;
      let resetInSeconds: number | null = null;

      if (typeof bRecord.resetTime === 'string') {
        resetTime = bRecord.resetTime;
        const resetMs = new Date(bRecord.resetTime).getTime();
        if (!Number.isNaN(resetMs)) {
          resetInSeconds = Math.max(0, Math.round((resetMs - now.getTime()) / 1000));
        }
      }

      const description = typeof bRecord.description === 'string' ? bRecord.description : null;
      const disabled = typeof bRecord.disabled === 'boolean' ? bRecord.disabled : false;
      const windowVal = bRecord.window as QuotaWindow;

      parsedBuckets.push({
        bucketId: bRecord.bucketId,
        displayName: bRecord.displayName,
        window: windowVal,
        remainingFraction: bRecord.remainingFraction,
        resetTime,
        resetInSeconds,
        description,
        disabled,
      });
    }

    parsedGroups.push({
      displayName: groupRecord.displayName,
      description: groupDescription,
      buckets: parsedBuckets,
    });
  }

  const topDescription = typeof record.description === 'string' ? record.description : null;

  return {
    source: 'quota_api',
    accountName: options?.accountName ?? null,
    email: options?.email ?? null,
    planTier: options?.planTier ?? null,
    title: 'Model Quotas',
    description: topDescription,
    groups: parsedGroups,
    credits: { available: false, balance: null },
    fetchedAt: options?.fetchedAt ?? new Date().toISOString(),
    cached: false,
    stale: false,
  };
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface CachedTier {
  planTier: string | null;
  project: string | null;
  cachedAt: number;
}

export interface QuotaApiClientOptions {
  credentialStore: CredentialStore;
  oauthClientManager: OAuthClientManager;
  profile?: AgyProfile;
  fetchFn?: typeof fetch;
  logger?: Logger;
  requestTimeoutMs?: number;
}

export class QuotaApiClient implements QuotaProbePort {
  private readonly credentialStore: CredentialStore;
  private readonly oauthClientManager: OAuthClientManager;
  private readonly profile?: AgyProfile;
  private readonly fetchFn: typeof fetch;
  private readonly logger?: Logger;
  private readonly requestTimeoutMs: number;

  private readonly tokenCache = new Map<string, CachedToken>();
  private readonly tierCache = new Map<string, CachedTier>();

  constructor(options: QuotaApiClientOptions) {
    this.credentialStore = options.credentialStore;
    this.oauthClientManager = options.oauthClientManager;
    this.profile = options.profile;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.logger = options.logger;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
  }

  clearTokenCache(): void {
    this.tokenCache.clear();
    this.tierCache.clear();
  }

  private getUserAgent(): string {
    const version = this.profile?.agyVersion ?? '1.2.12';
    const platform = process.platform;
    const arch = process.arch;
    return `antigravity/${version} ${platform}/${arch}`;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchFn(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      const e = err as Error;
      if (controller.signal.aborted || e.name === 'AbortError') {
        throw new AppError(
          'QUOTA_FETCH_FAILED',
          `Quota request timed out after ${Math.round(timeoutMs / 1000)} seconds`,
        );
      }
      throw new AppError('QUOTA_FETCH_FAILED', redactSecrets(e.message));
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  private async extractTokensForAccount(accountName: string | null): Promise<{
    refreshToken: string | null;
    accessToken: string | null;
    aud: string | null;
    email: string | null;
  }> {
    let snapshot;
    if (accountName && this.credentialStore.hasSnapshot(accountName)) {
      snapshot = await this.credentialStore.loadSnapshot(accountName);
    } else {
      const isPresent = await this.credentialStore.isPresent();
      if (!isPresent) {
        throw new AppError('AGY_NOT_AUTHENTICATED', 'No live credentials found; log in to agy first');
      }
      snapshot = await this.credentialStore.takeLiveSnapshot();
    }

    for (const b64 of Object.values(snapshot.targets)) {
      try {
        const raw = Buffer.from(b64, 'base64').toString('utf-8');
        const parsed = JSON.parse(raw);
        const token = parsed?.token ?? {};
        const refreshToken =
          typeof token.refresh_token === 'string' && token.refresh_token.trim()
            ? token.refresh_token
            : null;
        const accessToken =
          typeof token.access_token === 'string' && token.access_token.trim()
            ? token.access_token
            : null;
        let aud: string | null = null;
        let email: string | null = null;
        if (typeof parsed?.id_token === 'string') {
          const claims = parseJwtPayload(parsed.id_token);
          if (claims) {
            if (typeof claims.aud === 'string') aud = claims.aud;
            if (typeof claims.email === 'string') email = claims.email;
          }
        }
        if (refreshToken || accessToken) {
          return { refreshToken, accessToken, aud, email };
        }
      } catch {
        // Continue checking other targets
      }
    }

    throw new AppError('AGY_NOT_AUTHENTICATED', 'Credential entry exists but contains no valid tokens');
  }

  private async exchangeAccessToken(
    refreshToken: string,
    aud: string | null,
    accountKey: string,
  ): Promise<string> {
    const tokenUrl = this.profile?.quota?.tokenUrl ?? 'https://oauth2.googleapis.com/token';

    let creds = this.oauthClientManager.getClientCredentials(aud);
    if (!creds) {
      throw new AppError(
        'QUOTA_FETCH_FAILED',
        'No OAuth client candidates found in agy binary',
      );
    }

    while (creds) {
      const bodyParams = new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });

      let res: Response;
      try {
        res = await this.fetchWithTimeout(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: bodyParams.toString(),
        });
      } catch (err: unknown) {
        throw new AppError('QUOTA_FETCH_FAILED', redactSecrets((err as Error).message));
      }

      if (res.status === 200) {
        const data = (await res.json()) as { access_token?: string; expires_in?: number };
        if (!data.access_token) {
          throw new AppError('QUOTA_FETCH_FAILED', 'Token endpoint returned 200 without access_token');
        }
        this.oauthClientManager.rememberSuccess(creds.clientId, creds.clientSecret);

        const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
        this.tokenCache.set(accountKey, {
          accessToken: data.access_token,
          expiresAt: Date.now() + expiresIn * 1000,
        });

        return data.access_token;
      }

      if (res.status === 401) {
        let errJson: { error?: string; error_description?: string } = {};
        try {
          errJson = (await res.json()) as typeof errJson;
        } catch {}

        if (errJson.error === 'invalid_client') {
          this.oauthClientManager.markSecretInvalid(creds.clientId, creds.clientSecret);
          creds = this.oauthClientManager.getClientCredentials(aud);
          if (creds) {
            continue; // Retry with next secret candidate
          }
          throw new AppError('QUOTA_FETCH_FAILED', 'OAuth client invalid; all secret candidates exhausted');
        }

        throw new AppError(
          'QUOTA_FETCH_FAILED',
          `Token exchange returned 401: ${errJson.error_description ?? 'Unauthorized'}`,
        );
      }

      if (res.status === 400) {
        let errJson: { error?: string; error_description?: string } = {};
        try {
          errJson = (await res.json()) as typeof errJson;
        } catch {}

        if (errJson.error === 'invalid_grant') {
          throw new AppError(
            'AGY_NOT_AUTHENTICATED',
            'Refresh token is expired or revoked (invalid_grant); please log in to agy again',
          );
        }

        throw new AppError(
          'QUOTA_FETCH_FAILED',
          `Token exchange returned 400: ${errJson.error_description ?? 'Bad Request'}`,
        );
      }

      throw new AppError('QUOTA_FETCH_FAILED', `Token endpoint returned unexpected status ${res.status}`);
    }

    throw new AppError('QUOTA_FETCH_FAILED', 'No valid OAuth client credentials available');
  }

  private async getValidAccessToken(
    refreshToken: string | null,
    storedAccessToken: string | null,
    aud: string | null,
    accountKey: string,
  ): Promise<string> {
    const cached = this.tokenCache.get(accountKey);
    const now = Date.now();
    // Cache access token and refresh 60 seconds before expiry
    if (cached && cached.expiresAt - now > 60_000) {
      return cached.accessToken;
    }

    if (refreshToken) {
      return await this.exchangeAccessToken(refreshToken, aud, accountKey);
    }

    if (storedAccessToken) {
      return storedAccessToken;
    }

    throw new AppError('AGY_NOT_AUTHENTICATED', 'No refresh token available to acquire access token');
  }

  private async loadCodeAssistTier(
    accessToken: string,
    accountKey: string,
  ): Promise<{ planTier: string | null; project: string | null }> {
    const cached = this.tierCache.get(accountKey);
    const now = Date.now();
    // Low-frequency cache: 10 minutes
    if (cached && now - cached.cachedAt < 600_000) {
      return { planTier: cached.planTier, project: cached.project };
    }

    const url =
      this.profile?.quota?.loadCodeAssistUrl ??
      'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
    const userAgent = this.getUserAgent();

    try {
      const res = await this.fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': userAgent,
          },
          body: JSON.stringify({
            metadata: {
              ideType: this.profile?.quota?.ideType ?? 'ANTIGRAVITY',
            },
          }),
        },
        Math.min(5_000, this.requestTimeoutMs),
      );

      if (res.status === 200) {
        const data = (await res.json()) as {
          paidTier?: { name?: string };
          currentTier?: { name?: string };
          cloudaicompanionProject?: string;
        };
        const planTier = data.paidTier?.name ?? data.currentTier?.name ?? null;
        const project =
          typeof data.cloudaicompanionProject === 'string' ? data.cloudaicompanionProject : null;
        this.tierCache.set(accountKey, { planTier, project, cachedAt: now });
        return { planTier, project };
      }
    } catch (err: unknown) {
      this.logger?.debug?.(
        { err: redactSecrets((err as Error).message) },
        'loadCodeAssist call failed, falling back to empty project',
      );
    }

    return { planTier: null, project: null };
  }

  async probe(accountName: string | null): Promise<QuotaSnapshot> {
    const accountKey = accountName ?? '__default__';
    const { refreshToken, accessToken: storedAccessToken, aud, email } =
      await this.extractTokensForAccount(accountName);

    let accessToken = await this.getValidAccessToken(
      refreshToken,
      storedAccessToken,
      aud,
      accountKey,
    );

    const { planTier, project } = await this.loadCodeAssistTier(accessToken, accountKey);

    const quotaUrl =
      this.profile?.quota?.quotaSummaryUrl ??
      'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary';
    const userAgent = this.getUserAgent();
    const reqBody = project ? JSON.stringify({ project }) : '{}';

    let res: Response;
    try {
      res = await this.fetchWithTimeout(quotaUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
        },
        body: reqBody,
      });
    } catch (err: unknown) {
      throw new AppError('QUOTA_FETCH_FAILED', redactSecrets((err as Error).message));
    }

    // 401 UNAUTHENTICATED -> clear in-memory token and retry once
    if (res.status === 401) {
      this.tokenCache.delete(accountKey);
      if (refreshToken) {
        accessToken = await this.exchangeAccessToken(refreshToken, aud, accountKey);
        try {
          res = await this.fetchWithTimeout(quotaUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'User-Agent': userAgent,
            },
            body: reqBody,
          });
        } catch (err: unknown) {
          throw new AppError('QUOTA_FETCH_FAILED', redactSecrets((err as Error).message));
        }
      }
    }

    if (res.status === 401) {
      throw new AppError(
        'AGY_NOT_AUTHENTICATED',
        'Quota API request unauthorized (UNAUTHENTICATED); credentials invalid',
      );
    }

    if (res.status !== 200) {
      throw new AppError('QUOTA_FETCH_FAILED', `Quota API returned status ${res.status}`);
    }

    let jsonBody: unknown;
    try {
      jsonBody = await res.json();
    } catch {
      throw new AppError('QUOTA_FETCH_FAILED', 'Failed to parse quota summary JSON response');
    }

    const snapshot = parseQuotaSummaryResponse(jsonBody, {
      accountName,
      email,
      planTier,
      now: new Date(),
    });
    if (!snapshot) {
      throw new AppError(
        'QUOTA_FETCH_FAILED',
        'Quota summary response missing required fields or groups',
      );
    }

    return snapshot;
  }
}
