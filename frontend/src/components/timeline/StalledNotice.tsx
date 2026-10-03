import React from 'react';
import type { StalledNoticeItem } from '../../domain/timeline.types';
import { AlertCircleIcon, ClockIcon } from './icons';

export interface StalledNoticeProps {
  item: StalledNoticeItem;
  className?: string;
}

export function StalledNotice({ item, className = '' }: StalledNoticeProps) {
  const idleSeconds = Math.max(1, Math.round(item.idleMs / 1000));

  return (
    <div
      className={`my-2.5 rounded-lg border border-status-warning/30 bg-status-warning-subtle p-3 text-xs text-status-warning-text shadow-sm transition-colors ${className}`}
      data-testid="stalled-notice"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-status-warning-text">
          <AlertCircleIcon className="w-4 h-4" />
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-status-warning-text">
              Agent 运行已卡滞或处于等待中
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-status-warning-subtle px-1.5 py-0.5 font-mono text-[10px] text-status-warning-text border border-status-warning/30">
              <ClockIcon className="w-2.5 h-2.5" />
              <span>{`无输出 ${idleSeconds}s`}</span>
            </span>
          </div>

          <p className="text-text-secondary leading-relaxed">
            {`当前运行在 ${idleSeconds} 秒内未产生新事件或日志。Agent 可能正在等待耗时子进程、网络响应或外部权限确认。`}
          </p>
        </div>
      </div>
    </div>
  );
}
