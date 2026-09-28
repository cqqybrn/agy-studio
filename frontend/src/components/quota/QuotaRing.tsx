import React, { useEffect, useRef, useState } from 'react';
import type { QuotaSnapshot } from '@agy-studio/contracts';
import { useQuotaStore } from '../../stores/quota.store';
import { getMinRemainingFraction, getQuotaColorLevel } from './formatQuota';
import { QuotaPanel } from './QuotaPanel';

export interface QuotaRingProps {
  /** 显式指定快照（用于测试或 Playground），缺省时读取全局 quota.store */
  snapshot?: QuotaSnapshot | null;
  /** 受控展开状态 */
  isOpen?: boolean;
  /** 展开切换回调 */
  onToggle?: () => void;
  className?: string;
}

export function QuotaRing({
  snapshot: propSnapshot,
  isOpen: controlledIsOpen,
  onToggle,
  className = '',
}: QuotaRingProps) {
  const isServer = typeof window === 'undefined';
  const storeState = useQuotaStore();
  const storeQuota = isServer ? useQuotaStore.getState().quota : storeState.quota;
  const snapshot = propSnapshot !== undefined ? propSnapshot : storeQuota;

  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : uncontrolledOpen;

  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部自动关闭
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        if (onToggle) {
          onToggle();
        } else {
          setUncontrolledOpen(false);
        }
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onToggle) {
          onToggle();
        } else {
          setUncontrolledOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onToggle]);

  const handleToggle = () => {
    if (onToggle) {
      onToggle();
    } else {
      setUncontrolledOpen((prev) => !prev);
    }
  };

  const minFraction = getMinRemainingFraction(snapshot);
  const level = getQuotaColorLevel(minFraction);

  // 颜色映射
  // success: 绿 #10b981
  // warning: 黄 #f59e0b
  // error: 红 #ef4444
  // unavailable: 灰 #5d6677
  let ringStrokeColorClass = 'text-border-default';
  let textColorClass = 'text-text-tertiary';

  if (level === 'success') {
    ringStrokeColorClass = 'text-status-success';
    textColorClass = 'text-status-success';
  } else if (level === 'warning') {
    ringStrokeColorClass = 'text-status-warning';
    textColorClass = 'text-status-warning';
  } else if (level === 'error') {
    ringStrokeColorClass = 'text-status-error';
    textColorClass = 'text-status-error';
  }

  const percentage = minFraction !== null ? Math.round(minFraction * 100) : null;

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={handleToggle}
        className={`flex items-center gap-1.5 rounded-lg border bg-bg-surface px-2 py-1 text-text-secondary transition-colors select-none ${
          isOpen
            ? 'border-border-strong bg-bg-surface-hover shadow-sm'
            : 'border-border-default hover:border-border-strong hover:text-text-primary'
        }`}
        data-testid="quota-badge"
        title="查看额度详情"
      >
        <div className="relative flex h-3.5 w-3.5 items-center justify-center">
          {level === 'unavailable' || percentage === null ? (
            <div className="relative flex h-full w-full items-center justify-center">
              <svg className="h-full w-full" viewBox="0 0 36 36">
                <circle
                  cx="18"
                  cy="18"
                  r="15.9155"
                  className="stroke-border-default fill-none"
                  strokeWidth="3.5"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-text-tertiary">
                ?
              </span>
            </div>
          ) : (
            <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 36 36">
              {/* 背景底轨 */}
              <circle
                cx="18"
                cy="18"
                r="15.9155"
                className="text-border-default stroke-current fill-none"
                strokeWidth="3.5"
              />
              {/* 进度环 */}
              <circle
                cx="18"
                cy="18"
                r="15.9155"
                className={`${ringStrokeColorClass} stroke-current fill-none transition-all duration-300`}
                strokeDasharray={`${percentage}, 100`}
                strokeWidth="3.5"
                strokeLinecap="round"
              />
            </svg>
          )}
        </div>

        {/* 文字百分比或问号 */}
        <span
          className={`font-mono text-[11px] font-medium ${
            percentage !== null ? 'text-text-primary' : 'text-text-tertiary'
          }`}
          data-testid="quota-percentage"
        >
          {percentage !== null ? `${percentage}%` : '?'}
        </span>
      </button>

      {/* 弹出面板 */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 z-50 animate-in fade-in zoom-in-95 duration-100">
          <QuotaPanel
            snapshot={snapshot}
            onClose={() => {
              if (onToggle) {
                onToggle();
              } else {
                setUncontrolledOpen(false);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
