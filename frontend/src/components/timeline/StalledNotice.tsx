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
      className={`my-2.5 rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-200 shadow-sm transition-colors ${className}`}
      data-testid="stalled-notice"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-amber-400">
          <AlertCircleIcon className="w-4 h-4" />
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-amber-300">
              Agent 运行已卡滞或处于等待中
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-300 border border-amber-500/30">
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
