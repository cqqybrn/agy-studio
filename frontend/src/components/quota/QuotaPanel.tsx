import React, { useEffect, useState } from 'react';
import type { QuotaBucket, QuotaSnapshot } from '@agy-studio/contracts';
import { useQuotaStore } from '../../stores/quota.store';
import {
  formatFetchedTime,
  formatQuotaSource,
  formatResetCountdown,
  localizeQuotaLabel,
} from './formatQuota';

export interface QuotaPanelProps {
  /** 显式指定快照（用于 Playground 或测试），缺省时使用全局 quota.store */
  snapshot?: QuotaSnapshot | null;
  /** 关闭回调 */
  onClose?: () => void;
  /** 自定义刷新回调，缺省时调用 quota.store.fetchQuota({ refresh: true }) */
  onRefresh?: () => Promise<void>;
  /** 外部控制的 loading 状态 */
  isLoading?: boolean;
  className?: string;
}

// 刷新限流冷却时间（2 分钟 = 120 秒）
const REFRESH_COOLDOWN_SECONDS = 120;

export function QuotaPanel({
  snapshot: propSnapshot,
  onClose,
  onRefresh,
  isLoading: propLoading,
  className = '',
}: QuotaPanelProps) {
  const isServer = typeof window === 'undefined';
  const storeState = useQuotaStore();
  const currentStore = isServer ? useQuotaStore.getState() : storeState;

  const storeQuota = currentStore.quota;
  const storeLoading = currentStore.loading;
  const storeError = currentStore.error;
  const storeFetchQuota = currentStore.fetchQuota;

  const snapshot = propSnapshot !== undefined ? propSnapshot : storeQuota;
  const isLoading = propLoading !== undefined ? propLoading : storeLoading;

  // 冷却倒计时状态
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const timer = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownRemaining]);

  const handleRefresh = async () => {
    if (isLoading) return;
    if (cooldownRemaining > 0) {
      setLocalMessage(`刷新限流保护中：请等待 ${cooldownRemaining} 秒后再试`);
      return;
    }

    setLocalMessage(null);
    try {
      if (onRefresh) {
        await onRefresh();
      } else {
        await storeFetchQuota({ refresh: true });
      }
      // 开启 2 分钟限流冷却
      setCooldownRemaining(REFRESH_COOLDOWN_SECONDS);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLocalMessage(`刷新失败: ${msg}`);
    }
  };

  const isUnavailable = !snapshot || snapshot.source === 'unavailable';

  return (
    <div
      className={`flex flex-col w-[380px] max-h-[85vh] rounded-xl border border-border-strong bg-bg-surface text-text-primary shadow-2xl backdrop-blur-md overflow-hidden ${className}`}
      data-testid="quota-panel"
    >
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border-default px-4 py-3 bg-bg-panel/70">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-accent font-semibold text-xs">
            ⚡
          </span>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="font-semibold text-sm text-text-primary">
                {localizeQuotaLabel(snapshot?.title) || '额度详情'}
              </h3>
              {snapshot?.planTier && (
                <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  {localizeQuotaLabel(snapshot.planTier)}
                </span>
              )}
            </div>
            {snapshot?.description && (
              <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-1">
                {localizeQuotaLabel(snapshot.description)}
              </p>
            )}
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-tertiary hover:bg-bg-surface-hover hover:text-text-primary transition-colors"
            title="关闭面板"
            data-testid="close-quota-panel"
          >
            ✕
          </button>
        )}
      </div>

      {/* 警告/提示条 */}
      {snapshot?.stale && (
        <div
          className="flex items-center gap-2 border-b border-color-warning/30 bg-color-warning-subtle/50 px-4 py-2 text-xs text-color-warning"
          data-testid="quota-stale-notice"
        >
          <span className="font-bold">⚠️</span>
          <span>数据可能过期（刷新失败，当前展示旧缓存数据）</span>
        </div>
      )}

      {/* 主体滚动区 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* 不可用状态 */}
        {isUnavailable ? (
          <div
            className="flex flex-col items-center justify-center py-8 text-center text-text-secondary"
            data-testid="quota-unavailable-state"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-border-default/50 text-text-tertiary text-2xl font-bold mb-3">
              ?
            </div>
            <h4 className="text-sm font-medium text-text-primary">额度暂不可用</h4>
            <p className="text-xs text-text-tertiary mt-1.5 max-w-[260px] leading-relaxed">
              {snapshot?.description
                ? localizeQuotaLabel(snapshot.description)
                : '当前暂未探测到额度信息或额度服务异常，这不影响正常的会话交互与任务执行。'}
            </p>
          </div>
        ) : (
          <>
            {/* 积分 Credits 展示（若有） */}
            {snapshot.credits?.available && (
              <div className="flex items-center justify-between rounded-lg border border-border-default bg-bg-panel/50 px-3 py-2 text-xs">
                <span className="text-text-secondary">积分余额</span>
                <span className="font-mono font-medium text-text-primary">
                  {snapshot.credits.balance !== null ? snapshot.credits.balance : '无限'}
                </span>
              </div>
            )}

            {/* 分组与桶 */}
            {snapshot.groups?.map((group, groupIdx) => (
              <div key={groupIdx} className="space-y-2.5">
                <div className="flex items-baseline justify-between border-b border-border-subtle pb-1">
                  <span className="text-xs font-semibold text-text-secondary">
                    {localizeQuotaLabel(group.displayName)}
                  </span>
                  {group.description && (
                    <span className="text-[11px] text-text-tertiary">
                      {localizeQuotaLabel(group.description)}
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  {group.buckets?.map((bucket) => (
                    <BucketItem key={bucket.bucketId} bucket={bucket} />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {/* 提示消息 */}
        {localMessage && (
          <div className="rounded border border-border-default bg-bg-panel px-3 py-2 text-xs text-text-secondary">
            {localMessage}
          </div>
        )}

        {storeError && !localMessage && (
          <div className="rounded border border-color-error/30 bg-status-error-subtle/40 px-3 py-2 text-xs text-color-error">
            {storeError}
          </div>
        )}
      </div>

      {/* 底部元数据与刷新操作 */}
      <div className="border-t border-border-default bg-bg-panel/80 px-4 py-2.5 text-xs text-text-tertiary">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span>数据来源：</span>
              <span className="font-mono text-text-secondary font-medium">
                {formatQuotaSource(snapshot?.source)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span>获取时间：</span>
              <span className="font-mono">
                {formatFetchedTime(snapshot?.fetchedAt)}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isLoading || cooldownRemaining > 0}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium transition-all ${
                isLoading || cooldownRemaining > 0
                  ? 'border-border-default bg-bg-surface-active text-text-tertiary cursor-not-allowed'
                  : 'border-border-strong bg-bg-surface hover:bg-bg-surface-hover text-text-primary hover:border-accent'
              }`}
              data-testid="refresh-quota-button"
            >
              <span className={isLoading ? 'animate-spin inline-block' : ''}>
                🔄
              </span>
              <span>
                {isLoading
                  ? '刷新中…'
                  : cooldownRemaining > 0
                    ? `冷却中（${cooldownRemaining} 秒）`
                    : '刷新额度'}
              </span>
            </button>

            {cooldownRemaining > 0 && (
              <span className="text-[10px] text-color-warning">
                2 分钟限流保护中
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BucketItem({ bucket }: { bucket: QuotaBucket }) {
  const rawFraction = bucket.remainingFraction;
  const fraction = rawFraction > 1 ? rawFraction / 100 : Math.max(0, rawFraction);
  const percentage = Math.round(fraction * 100);

  // 进度条颜色规则：
  // disabled: 灰色
  // > 50%: 绿色
  // 20% - 50%: 黄色
  // < 20%: 红色
  let barColorClass = 'bg-status-success';
  let badgeColorClass = 'text-status-success';

  if (bucket.disabled) {
    barColorClass = 'bg-text-tertiary';
    badgeColorClass = 'text-text-tertiary';
  } else if (fraction > 0.5) {
    barColorClass = 'bg-status-success';
    badgeColorClass = 'text-status-success';
  } else if (fraction >= 0.2) {
    barColorClass = 'bg-status-warning';
    badgeColorClass = 'text-status-warning';
  } else {
    barColorClass = 'bg-status-error';
    badgeColorClass = 'text-status-error';
  }

  const windowLabel = bucket.window === '5h' ? '5小时' : bucket.window === 'weekly' ? '每周' : bucket.window;
  const countdownText = formatResetCountdown(bucket.resetInSeconds, bucket.resetTime);

  return (
    <div
      className={`rounded-lg border border-border-default p-2.5 transition-opacity ${
        bucket.disabled ? 'bg-bg-panel/40 opacity-50' : 'bg-bg-surface hover:border-border-strong'
      }`}
      data-testid={`quota-bucket-${bucket.bucketId}`}
    >
      <div className="flex items-center justify-between text-xs mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-text-primary">
            {localizeQuotaLabel(bucket.displayName)}
          </span>
          <span className="rounded bg-bg-panel px-1.5 py-0.2 text-[10px] font-mono text-text-tertiary border border-border-subtle">
            {windowLabel}
          </span>
          {bucket.disabled && (
            <span className="text-[11px] text-text-tertiary font-mono">
              (已禁用)
            </span>
          )}
        </div>
        <span className={`font-mono font-bold text-xs ${badgeColorClass}`}>
          {bucket.disabled ? '--' : `${percentage}%`}
        </span>
      </div>

      {/* 进度条 */}
      <div className="h-1.5 w-full rounded-full bg-border-default overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColorClass}`}
          style={{ width: bucket.disabled ? '0%' : `${percentage}%` }}
        />
      </div>

      {/* 底部信息：剩余与倒计时 */}
      <div className="flex items-center justify-between mt-1.5 text-[11px] text-text-tertiary">
        <span>
          {bucket.disabled ? '已停用' : `剩余 ${percentage}%`}
        </span>
        <span className="font-mono">
          {countdownText}
        </span>
      </div>
    </div>
  );
}
