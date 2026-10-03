import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuotaBucket, QuotaSnapshot } from '@agy-studio/contracts';
import { useQuotaStore } from '../../stores/quota.store';
import {
  formatFetchedTime,
  formatQuotaSource,
  formatResetCountdown,
  getMinRemainingFraction,
  getQuotaColorLevel,
  localizeQuotaLabel,
  QuotaPanel,
  QuotaRing,
} from './index';

// ----------------------------------------------------------------------------
// Test Mock Fixtures
// ----------------------------------------------------------------------------

function createSnapshot(overrides: Partial<QuotaSnapshot> = {}): QuotaSnapshot {
  return {
    source: 'quota_api',
    accountName: 'test-user',
    email: 'test@example.com',
    planTier: 'pro',
    title: 'Claude 3.7 Sonnet 额度',
    description: '常规与扩展模型配额',
    groups: [
      {
        displayName: '常用模型',
        description: '标准限制',
        buckets: [
          {
            bucketId: 'b-5h',
            displayName: '5小时窗口',
            window: '5h',
            remainingFraction: 0.8,
            resetTime: null,
            resetInSeconds: 8100, // 2 小时 15 分
            description: null,
            disabled: false,
          },
        ],
      },
    ],
    credits: { available: true, balance: 1200 },
    fetchedAt: '2026-09-28T14:30:00.000Z',
    cached: true,
    stale: false,
    ...overrides,
  };
}

describe('Quota Helper Functions (formatQuota)', () => {
  it('calculates minimum remaining fraction ignoring disabled buckets', () => {
    const snap = createSnapshot({
      groups: [
        {
          displayName: 'G1',
          description: null,
          buckets: [
            {
              bucketId: 'b-disabled',
              displayName: 'Disabled Bucket',
              window: '5h',
              remainingFraction: 0.05,
              resetTime: null,
              resetInSeconds: null,
              description: null,
              disabled: true,
            },
            {
              bucketId: 'b-active-1',
              displayName: 'Active Bucket 1',
              window: '5h',
              remainingFraction: 0.65,
              resetTime: null,
              resetInSeconds: null,
              description: null,
              disabled: false,
            },
            {
              bucketId: 'b-active-2',
              displayName: 'Active Bucket 2',
              window: 'weekly',
              remainingFraction: 0.45,
              resetTime: null,
              resetInSeconds: null,
              description: null,
              disabled: false,
            },
          ],
        },
      ],
    });

    const min = getMinRemainingFraction(snap);
    expect(min).toBe(0.45);
  });

  it('returns null when all buckets are disabled or source is unavailable', () => {
    const allDisabledSnap = createSnapshot({
      groups: [
        {
          displayName: 'G1',
          description: null,
          buckets: [
            {
              bucketId: 'b-1',
              displayName: 'Disabled',
              window: '5h',
              remainingFraction: 0.1,
              resetTime: null,
              resetInSeconds: null,
              description: null,
              disabled: true,
            },
          ],
        },
      ],
    });
    expect(getMinRemainingFraction(allDisabledSnap)).toBeNull();

    const unavailableSnap = createSnapshot({ source: 'unavailable' });
    expect(getMinRemainingFraction(unavailableSnap)).toBeNull();

    expect(getMinRemainingFraction(null)).toBeNull();
  });

  it('maps fraction correctly to color levels', () => {
    expect(getQuotaColorLevel(0.85)).toBe('success'); // > 50%
    expect(getQuotaColorLevel(0.51)).toBe('success');
    expect(getQuotaColorLevel(0.5)).toBe('warning'); // 20% - 50%
    expect(getQuotaColorLevel(0.2)).toBe('warning');
    expect(getQuotaColorLevel(0.19)).toBe('error'); // < 20%
    expect(getQuotaColorLevel(0.0)).toBe('error');
    expect(getQuotaColorLevel(null)).toBe('unavailable');
  });

  it('formats reset countdown with exact human-friendly conversions', () => {
    // 2 小时 15 分 = 2 * 3600 + 15 * 60 = 8100 秒
    expect(formatResetCountdown(8100, null)).toBe('还剩 2 小时 15 分');

    // 45 分钟 = 45 * 60 = 2700 秒
    expect(formatResetCountdown(2700, null)).toBe('还剩 45 分钟');

    // 2 天 3 小时 = 2 * 86400 + 3 * 3600 = 183600 秒
    expect(formatResetCountdown(183600, null)).toBe('还剩 2 天 3 小时');

    // 30 秒
    expect(formatResetCountdown(30, null)).toBe('还剩 30 秒');

    // 0 或负数
    expect(formatResetCountdown(0, null)).toBe('已重置');
    expect(formatResetCountdown(-5, null)).toBe('已重置');

    // 根据 resetTime 计算
    const now = 10000000;
    const future = new Date(now + 3600 * 1000).toISOString();
    expect(formatResetCountdown(null, future, now)).toBe('还剩 1 小时');

    // 无信息
    expect(formatResetCountdown(null, null)).toBe('--');
  });

  it('formats quota source correctly', () => {
    expect(formatQuotaSource('quota_api')).toBe('额度接口');
    expect(formatQuotaSource('statusline')).toBe('状态行');
    expect(formatQuotaSource('cli_probe')).toBe('命令行探测');
    expect(formatQuotaSource('unavailable')).toBe('不可用');
  });

  it('localizes English quota labels from the API', () => {
    expect(localizeQuotaLabel('Model Quotas')).toBe('模型额度');
    expect(localizeQuotaLabel('Google AI Pro')).toBe('Google AI 专业版');
    expect(localizeQuotaLabel('Weekly Limit Remaining')).toBe('每周剩余额度');
    expect(localizeQuotaLabel('Five Hour Limit Remaining')).toBe('五小时剩余额度');
    expect(localizeQuotaLabel('Gemini Models')).toBe('Gemini 模型');
    expect(localizeQuotaLabel('Claude and GPT models')).toBe('Claude 与 GPT 模型');
    expect(localizeQuotaLabel('常用模型')).toBe('常用模型');
  });
});

describe('QuotaRing Component', () => {
  beforeEach(() => {
    useQuotaStore.setState({ quota: null, loading: false, error: null });
  });

  it('renders green indicator when fraction > 50%', () => {
    const snap = createSnapshot({
      groups: [
        {
          displayName: 'G',
          description: null,
          buckets: [
            {
              bucketId: 'b-1',
              displayName: 'B',
              window: '5h',
              remainingFraction: 0.78,
              resetTime: null,
              resetInSeconds: null,
              description: null,
              disabled: false,
            },
          ],
        },
      ],
    });

    const html = renderToString(<QuotaRing snapshot={snap} />);
    expect(html).toContain('78%');
    expect(html).toContain('text-status-success');
    expect(html).toContain('data-testid="quota-badge"');
  });

  it('renders yellow indicator when fraction is between 20% and 50%', () => {
    const snap = createSnapshot({
      groups: [
        {
          displayName: 'G',
          description: null,
          buckets: [
            {
              bucketId: 'b-1',
              displayName: 'B',
              window: '5h',
              remainingFraction: 0.35,
              resetTime: null,
              resetInSeconds: null,
              description: null,
              disabled: false,
            },
          ],
        },
      ],
    });

    const html = renderToString(<QuotaRing snapshot={snap} />);
    expect(html).toContain('35%');
    expect(html).toContain('text-status-warning');
  });

  it('renders red indicator when fraction < 20%', () => {
    const snap = createSnapshot({
      groups: [
        {
          displayName: 'G',
          description: null,
          buckets: [
            {
              bucketId: 'b-1',
              displayName: 'B',
              window: '5h',
              remainingFraction: 0.12,
              resetTime: null,
              resetInSeconds: null,
              description: null,
              disabled: false,
            },
          ],
        },
      ],
    });

    const html = renderToString(<QuotaRing snapshot={snap} />);
    expect(html).toContain('12%');
    expect(html).toContain('text-status-error');
  });

  it('renders gray question mark when source is unavailable or no data', () => {
    const unavailableSnap = createSnapshot({ source: 'unavailable' });
    const htmlUnavailable = renderToString(<QuotaRing snapshot={unavailableSnap} />);
    expect(htmlUnavailable).toContain('?');
    expect(htmlUnavailable).toContain('stroke-border-default');

    const htmlNull = renderToString(<QuotaRing snapshot={null} />);
    expect(htmlNull).toContain('?');
  });

  it('renders QuotaPanel when isOpen is true', () => {
    const snap = createSnapshot();
    const htmlClosed = renderToString(<QuotaRing snapshot={snap} isOpen={false} />);
    expect(htmlClosed).not.toContain('data-testid="quota-panel"');

    const htmlOpen = renderToString(<QuotaRing snapshot={snap} isOpen={true} />);
    expect(htmlOpen).toContain('data-testid="quota-panel"');
    expect(htmlOpen).toContain('Claude 3.7 Sonnet 额度');
  });
});

describe('QuotaPanel Component', () => {
  it('renders buckets with progress bars and reset countdowns', () => {
    const snap = createSnapshot({
      groups: [
        {
          displayName: '核心配额分组',
          description: '高频调用池',
          buckets: [
            {
              bucketId: 'b-main',
              displayName: '5小时限制',
              window: '5h',
              remainingFraction: 0.85,
              resetTime: null,
              resetInSeconds: 8100, // 还剩 2 小时 15 分
              description: '主会话请求',
              disabled: false,
            },
            {
              bucketId: 'b-exp',
              displayName: '实验特性',
              window: 'weekly',
              remainingFraction: 0.0,
              resetTime: null,
              resetInSeconds: null,
              description: '未启用',
              disabled: true,
            },
          ],
        },
      ],
    });

    const html = renderToString(<QuotaPanel snapshot={snap} />);
    expect(html).toContain('核心配额分组');
    expect(html).toContain('5小时限制');
    expect(html).toContain('85%');
    expect(html).toContain('还剩 2 小时 15 分');

    // 验证 disabled 桶置灰并标记
    expect(html).toContain('实验特性');
    expect(html).toContain('(已禁用)');
    expect(html).toContain('opacity-50');

    // 验证底部来源与时间
    expect(html).toContain('额度接口');
    expect(html).toContain('刷新额度');
  });

  it('renders stale warning notice when stale is true', () => {
    const staleSnap = createSnapshot({ stale: true });
    const html = renderToString(<QuotaPanel snapshot={staleSnap} />);
    expect(html).toContain('data-testid="quota-stale-notice"');
    expect(html).toContain('数据可能过期');
  });

  it('renders unavailable state block when source is unavailable', () => {
    const unavailSnap = createSnapshot({ source: 'unavailable', groups: [], description: null });
    const html = renderToString(<QuotaPanel snapshot={unavailSnap} />);
    expect(html).toContain('data-testid="quota-unavailable-state"');
    expect(html).toContain('额度暂不可用');
    expect(html).toContain('这不影响正常的会话交互与任务执行');
    expect(html).toContain('data-testid="refresh-quota-button"');
  });

  it('renders probe failure description in the unavailable block', () => {
    const unavailSnap = createSnapshot({
      source: 'unavailable',
      groups: [],
      description: '查询超时：无法在限定时间内连上 Google 额度接口，请检查网络后重试',
    });
    const html = renderToString(<QuotaPanel snapshot={unavailSnap} />);
    expect(html).toContain('查询超时：无法在限定时间内连上 Google 额度接口');
  });

  it('renders loading state for refresh button', () => {
    const snap = createSnapshot();
    const html = renderToString(<QuotaPanel snapshot={snap} isLoading={true} />);
    expect(html).toContain('刷新中…');
    expect(html).toContain('cursor-not-allowed');
  });
});
