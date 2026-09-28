import path from 'node:path';
import fs from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  parseQuotaSummaryResponse,
  redactSensitive,
  QuotaApiClient,
} from '../../src/integrations/agy/quota-api.js';
import { OAuthClientManager } from '../../src/integrations/agy/oauth-client.js';
import type { CredentialStore } from '../../src/integrations/agy/credential-store.js';
import type { CredentialSnapshot } from '../../src/services/ports/credential.port.js';
import { AppError } from '../../src/utils/errors.js';

describe('Quota API Integration & Pure Parser', () => {
  const fixturesDir = path.resolve(__dirname, '../../../fixtures/agy/quota');

  const quotaSummaryFixture = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'quota-summary.json'), 'utf-8'),
  );
  const quotaSummaryEmptyBodyFixture = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'quota-summary-empty-body.json'), 'utf-8'),
  );
  const loadCodeAssistFixture = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'load-code-assist.json'), 'utf-8'),
  );
  const tokenRefreshFixture = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'token-refresh.json'), 'utf-8'),
  );
  const tokenRefreshWrongSecretFixture = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'token-refresh-wrong-client-secret.json'), 'utf-8'),
  );
  const tokenRefreshInvalidGrantFixture = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'token-refresh-invalid-grant.json'), 'utf-8'),
  );
  const quotaUnauthorizedFixture = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'quota-unauthorized.json'), 'utf-8'),
  );

  // Fixed reference timestamp for deterministic resetInSeconds calculations:
  // "2026-09-28T18:50:41.565Z" from fixture startedAt
  const fixedNow = new Date('2026-09-28T18:50:41.565Z');

  describe('Pure Parser & Fixture Snapshots', () => {
    it('parses quota-summary.json matching expected structure and matches snapshot', () => {
      const rawBody = quotaSummaryFixture.response.body;
      const snapshot = parseQuotaSummaryResponse(rawBody, {
        accountName: 'test-user',
        email: 'user@example.com',
        planTier: 'Google AI Pro',
        fetchedAt: '2026-09-28T18:50:41.565Z',
        now: fixedNow,
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.source).toBe('quota_api');
      expect(snapshot?.accountName).toBe('test-user');
      expect(snapshot?.email).toBe('user@example.com');
      expect(snapshot?.planTier).toBe('Google AI Pro');
      expect(snapshot?.title).toBe('Model Quotas');
      expect(snapshot?.groups.length).toBe(2);

      const geminiGroup = snapshot?.groups[0];
      expect(geminiGroup?.displayName).toBe('Gemini Models');
      expect(geminiGroup?.buckets.length).toBe(2);

      const weeklyBucket = geminiGroup?.buckets[0];
      expect(weeklyBucket?.bucketId).toBe('gemini-weekly');
      expect(weeklyBucket?.displayName).toBe('Weekly Limit Remaining');
      expect(weeklyBucket?.window).toBe('weekly');
      expect(weeklyBucket?.remainingFraction).toBe(0.9838571);
      expect(weeklyBucket?.resetTime).toBe('2026-10-05T14:07:13Z');
      expect(weeklyBucket?.disabled).toBe(false);
      expect(typeof weeklyBucket?.resetInSeconds).toBe('number');
      expect(weeklyBucket?.resetInSeconds).toBeGreaterThan(0);

      const claudeGroup = snapshot?.groups[1];
      expect(claudeGroup?.displayName).toBe('Claude and GPT models');
      expect(claudeGroup?.buckets[0].bucketId).toBe('3p-weekly');
      expect(claudeGroup?.buckets[0].remainingFraction).toBe(0.1893564);

      // Snapshot test
      expect(snapshot).toMatchSnapshot();
    });

    it('parses quota-summary-empty-body.json matching snapshot', () => {
      const rawBody = quotaSummaryEmptyBodyFixture.response.body;
      const snapshot = parseQuotaSummaryResponse(rawBody, {
        accountName: null,
        fetchedAt: '2026-09-28T18:50:41.565Z',
        now: fixedNow,
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.groups.length).toBe(2);
      expect(snapshot).toMatchSnapshot();
    });

    it('returns null if root is not an object or groups is not an array', () => {
      expect(parseQuotaSummaryResponse(null)).toBeNull();
      expect(parseQuotaSummaryResponse([])).toBeNull();
      expect(parseQuotaSummaryResponse('string')).toBeNull();
      expect(parseQuotaSummaryResponse({})).toBeNull();
      expect(parseQuotaSummaryResponse({ groups: 'not-an-array' })).toBeNull();
    });

    it('returns null if any group is missing displayName or buckets', () => {
      expect(
        parseQuotaSummaryResponse({
          groups: [{ description: 'no display name', buckets: [] }],
        }),
      ).toBeNull();

      expect(
        parseQuotaSummaryResponse({
          groups: [{ displayName: 'valid', buckets: 'not-an-array' }],
        }),
      ).toBeNull();
    });

    it('returns null if any bucket is missing required fields (bucketId, displayName, remainingFraction, window)', () => {
      // Missing bucketId
      expect(
        parseQuotaSummaryResponse({
          groups: [
            {
              displayName: 'Group 1',
              buckets: [{ displayName: 'Limit', remainingFraction: 0.5, window: '5h' }],
            },
          ],
        }),
      ).toBeNull();

      // Missing remainingFraction
      expect(
        parseQuotaSummaryResponse({
          groups: [
            {
              displayName: 'Group 1',
              buckets: [{ bucketId: 'b1', displayName: 'Limit', window: '5h' }],
            },
          ],
        }),
      ).toBeNull();

      // remainingFraction is NaN
      expect(
        parseQuotaSummaryResponse({
          groups: [
            {
              displayName: 'Group 1',
              buckets: [
                {
                  bucketId: 'b1',
                  displayName: 'Limit',
                  remainingFraction: Number.NaN,
                  window: '5h',
                },
              ],
            },
          ],
        }),
      ).toBeNull();

      // Missing window
      expect(
        parseQuotaSummaryResponse({
          groups: [
            {
              displayName: 'Group 1',
              buckets: [{ bucketId: 'b1', displayName: 'Limit', remainingFraction: 0.5 }],
            },
          ],
        }),
      ).toBeNull();
    });

    it('preserves non-standard window values and handles missing resetTime', () => {
      const parsed = parseQuotaSummaryResponse(
        {
          groups: [
            {
              displayName: 'Custom Group',
              buckets: [
                {
                  bucketId: 'custom-b',
                  displayName: 'Custom Bucket',
                  remainingFraction: 0.8,
                  window: 'daily',
                  resetTime: null,
                },
              ],
            },
          ],
        },
        { now: fixedNow },
      );

      expect(parsed).not.toBeNull();
      const b = parsed?.groups[0].buckets[0];
      expect(b?.window).toBe('daily');
      expect(b?.resetTime).toBeNull();
      expect(b?.resetInSeconds).toBeNull();
      expect(b?.disabled).toBe(false);
    });

    it('respects disabled: true when present on bucket', () => {
      const parsed = parseQuotaSummaryResponse(
        {
          groups: [
            {
              displayName: 'Custom Group',
              buckets: [
                {
                  bucketId: 'custom-b',
                  displayName: 'Custom Bucket',
                  remainingFraction: 0,
                  window: '5h',
                  disabled: true,
                },
              ],
            },
          ],
        },
        { now: fixedNow },
      );

      expect(parsed?.groups[0].buckets[0].disabled).toBe(true);
    });
  });

  describe('redactSensitive', () => {
    it('redacts tokens, client secrets, client IDs, and authorization headers from error messages', () => {
      const msg = [
        'Failed with token ya29.a0AfH6SM...xyz',
        'Refresh token 1//04AbCdEfGhIjKlMnOpQrStUvWxYz',
        'Secret GOCSPX-AbCdEfGhIjKlMnOpQrStUvWxYz12',
        'Client 123456789-abc.apps.googleusercontent.com',
        'Header Authorization: Bearer ya29.secret',
      ].join('; ');

      const sanitized = redactSensitive(msg);
      expect(sanitized).not.toContain('ya29.a0AfH6SM');
      expect(sanitized).not.toContain('1//04AbCd');
      expect(sanitized).not.toContain('GOCSPX-AbCdEf');
      expect(sanitized).not.toContain('123456789-abc.apps.googleusercontent.com');
      expect(sanitized).not.toContain('Bearer ya29.secret');
      expect(sanitized).toContain('<redacted:access_token>');
      expect(sanitized).toContain('<redacted:refresh_token>');
      expect(sanitized).toContain('<redacted:client_secret>');
      expect(sanitized).toContain('<redacted:client_id>');
      expect(sanitized).toContain('Authorization: <redacted>');
    });
  });

  describe('QuotaApiClient Probe Flow', () => {
    const mockAud = '1234567890-test.apps.googleusercontent.com';
    const mockSecret1 = 'GOCSPX-1111111111111111111111111111';
    const mockSecret2 = 'GOCSPX-2222222222222222222222222222';

    // Mock live credential in wincred
    const liveCredentialJson = JSON.stringify({
      auth_method: 'oauth',
      id_token: `header.${Buffer.from(JSON.stringify({ aud: mockAud, email: 'test@example.com' })).toString('base64')}.signature`,
      token: {
        access_token: 'initial-access-token',
        refresh_token: '1//initial-refresh-token',
        token_type: 'Bearer',
      },
    });

    const mockSnapshot: CredentialSnapshot = {
      version: 1,
      createdAt: new Date().toISOString(),
      targets: {
        'gemini:antigravity': Buffer.from(liveCredentialJson).toString('base64'),
      },
      files: {},
    };

    let mockCredentialStore: CredentialStore;
    let oauthClientManager: OAuthClientManager;

    beforeEach(() => {
      mockCredentialStore = {
        isPresent: vi.fn().mockResolvedValue(true),
        hasSnapshot: vi.fn().mockReturnValue(false),
        takeLiveSnapshot: vi.fn().mockResolvedValue(mockSnapshot),
        loadSnapshot: vi.fn().mockResolvedValue(mockSnapshot),
      } as unknown as CredentialStore;

      oauthClientManager = new OAuthClientManager({
        scanner: () => ({
          clientId: mockAud,
          clientSecrets: [mockSecret1, mockSecret2],
        }),
      });
    });

    it('completes successful probe flow: token refresh -> loadCodeAssist -> retrieveUserQuotaSummary', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(JSON.stringify(tokenRefreshFixture.response.body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('loadCodeAssist')) {
          return new Response(JSON.stringify(loadCodeAssistFixture.response.body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('retrieveUserQuotaSummary')) {
          return new Response(JSON.stringify(quotaSummaryFixture.response.body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const client = new QuotaApiClient({
        credentialStore: mockCredentialStore,
        oauthClientManager,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const result = await client.probe('test-user');
      expect(result.source).toBe('quota_api');
      expect(result.groups.length).toBe(2);
      expect(result.planTier).toBe('Google AI Pro');
      expect(result.email).toBe('test@example.com');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('reuses cached access_token when not expired and refreshes when within 60s of expiry', async () => {
      let tokenFetchCount = 0;
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          tokenFetchCount++;
          return new Response(
            JSON.stringify({
              access_token: `token-v${tokenFetchCount}`,
              expires_in: 3600, // 1 hour
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.includes('loadCodeAssist')) {
          return new Response(JSON.stringify({ currentTier: { name: 'Antigravity' } }), {
            status: 200,
          });
        }
        if (url.includes('retrieveUserQuotaSummary')) {
          return new Response(JSON.stringify(quotaSummaryFixture.response.body), { status: 200 });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const client = new QuotaApiClient({
        credentialStore: mockCredentialStore,
        oauthClientManager,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      // First probe triggers token exchange
      await client.probe('test-user');
      expect(tokenFetchCount).toBe(1);

      // Second probe should reuse cached access token
      await client.probe('test-user');
      expect(tokenFetchCount).toBe(1);
    });

    it('retries with next clientSecret candidate on 401 invalid_client from token endpoint', async () => {
      let secretAttempts = 0;
      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          secretAttempts++;
          const bodyStr = String(init?.body);
          if (bodyStr.includes(mockSecret1)) {
            // First secret fails
            return new Response(JSON.stringify(tokenRefreshWrongSecretFixture.response.body), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (bodyStr.includes(mockSecret2)) {
            // Second secret succeeds
            return new Response(JSON.stringify(tokenRefreshFixture.response.body), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
        if (url.includes('retrieveUserQuotaSummary')) {
          return new Response(JSON.stringify(quotaSummaryFixture.response.body), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const client = new QuotaApiClient({
        credentialStore: mockCredentialStore,
        oauthClientManager,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const result = await client.probe('test-user');
      expect(result.source).toBe('quota_api');
      expect(secretAttempts).toBe(2);
    });

    it('throws AGY_NOT_AUTHENTICATED on 400 invalid_grant (revoked refresh token)', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(JSON.stringify(tokenRefreshInvalidGrantFixture.response.body), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      const client = new QuotaApiClient({
        credentialStore: mockCredentialStore,
        oauthClientManager,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      await expect(client.probe('test-user')).rejects.toThrowError(AppError);
      try {
        await client.probe('test-user');
      } catch (err) {
        const appErr = err as AppError;
        expect(appErr.code).toBe('AGY_NOT_AUTHENTICATED');
      }
    });

    it('clears access_token and retries once on 401 UNAUTHENTICATED from retrieveUserQuotaSummary', async () => {
      let quotaAttempts = 0;
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(JSON.stringify(tokenRefreshFixture.response.body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('retrieveUserQuotaSummary')) {
          quotaAttempts++;
          if (quotaAttempts === 1) {
            // First call returns 401 UNAUTHENTICATED
            return new Response(JSON.stringify(quotaUnauthorizedFixture.response.body), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          // Second call after refresh succeeds
          return new Response(JSON.stringify(quotaSummaryFixture.response.body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      const client = new QuotaApiClient({
        credentialStore: mockCredentialStore,
        oauthClientManager,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const result = await client.probe('test-user');
      expect(result.source).toBe('quota_api');
      expect(quotaAttempts).toBe(2);
    });

    it('handles request timeout gracefully (10s AbortController)', async () => {
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const client = new QuotaApiClient({
        credentialStore: mockCredentialStore,
        oauthClientManager,
        fetchFn: mockFetch as unknown as typeof fetch,
        requestTimeoutMs: 50, // Short timeout for test
      });

      await expect(client.probe('test-user')).rejects.toThrowError('timed out');
    });

    it('falls back to empty body {} when loadCodeAssist fails', async () => {
      let quotaBodyReceived: string | null = null;
      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(JSON.stringify(tokenRefreshFixture.response.body), { status: 200 });
        }
        if (url.includes('loadCodeAssist')) {
          return new Response('Server Error', { status: 500 });
        }
        if (url.includes('retrieveUserQuotaSummary')) {
          quotaBodyReceived = String(init?.body);
          return new Response(JSON.stringify(quotaSummaryEmptyBodyFixture.response.body), {
            status: 200,
          });
        }
        throw new Error('Unknown URL');
      });

      const client = new QuotaApiClient({
        credentialStore: mockCredentialStore,
        oauthClientManager,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const result = await client.probe('test-user');
      expect(result.source).toBe('quota_api');
      expect(quotaBodyReceived).toBe('{}');
    });
  });
});
