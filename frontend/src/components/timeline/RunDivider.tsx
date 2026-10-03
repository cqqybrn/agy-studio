import React from 'react';
import type { RunDividerItem } from '../../domain/timeline.types';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
} from './icons';

export interface RunDividerProps {
  item: RunDividerItem;
  className?: string;
}

export function formatRunDuration(durationMs: number): string {
  if (durationMs < 0) return '0s';
  if (durationMs < 1000) return `${durationMs}ms`;
  const totalSeconds = durationMs / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSec = Math.round(totalSeconds % 60);
  return `${minutes}m ${remainingSec}s`;
}

export function RunDivider({ item, className = '' }: RunDividerProps) {
  const durationText = formatRunDuration(item.durationMs);

  const statusConfig = {
    completed: {
      label: 'Completed',
      textColor: 'text-status-success-text',
      badgeBg: 'bg-status-success-subtle border-status-success/20',
      icon: <CheckCircleIcon className="w-3.5 h-3.5 text-status-success-text" />,
    },
    failed: {
      label: 'Failed',
      textColor: 'text-status-error-text',
      badgeBg: 'bg-status-error-subtle border-status-error/20',
      icon: <XCircleIcon className="w-3.5 h-3.5 text-status-error-text" />,
    },
    aborted: {
      label: 'Aborted',
      textColor: 'text-status-warning-text',
      badgeBg: 'bg-status-warning-subtle border-status-warning/20',
      icon: <AlertCircleIcon className="w-3.5 h-3.5 text-status-warning-text" />,
    },
  }[item.status] || {
    label: item.status,
    textColor: 'text-text-secondary',
    badgeBg: 'bg-bg-surface border-border-default',
    icon: null,
  };

  const usage = item.usage;

  return (
    <div
      className={`relative my-6 flex items-center justify-center select-none ${className}`}
      data-testid="run-divider"
      data-status={item.status}
    >
      <div className="absolute inset-0 flex items-center" aria-hidden="true">
        <div className="w-full border-t border-border-subtle" />
      </div>

      <div className="relative flex flex-wrap items-center justify-center gap-2 rounded-full border border-border-default bg-bg-app px-3.5 py-1 text-[11px] font-mono text-text-tertiary shadow-sm">
        {/* Status Badge */}
        <span
          className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium ${statusConfig.badgeBg} ${statusConfig.textColor}`}
        >
          {statusConfig.icon}
          <span>{statusConfig.label}</span>
        </span>

        {/* Duration */}
        <span className="flex items-center gap-1 text-text-secondary" title="Execution duration">
          <ClockIcon className="w-3 h-3 text-text-tertiary" />
          <span>{durationText}</span>
        </span>

        {/* Token Usage */}
        {usage && (
          <span className="flex items-center gap-1.5 border-l border-border-default pl-2 text-text-tertiary">
            <span title="Prompt tokens">
              in: <span className="text-text-secondary">{usage.inputTokens.toLocaleString()}</span>
            </span>
            <span>·</span>
            <span title="Completion tokens">
              out: <span className="text-text-secondary">{usage.outputTokens.toLocaleString()}</span>
            </span>
            {usage.thinkingTokens > 0 && (
              <>
                <span>·</span>
                <span title="Thinking tokens">
                  thought: <span className="text-text-secondary">{usage.thinkingTokens.toLocaleString()}</span>
                </span>
              </>
            )}
            <span>·</span>
            <span title="Total tokens">
              total: <span className="text-text-primary font-medium">{usage.totalTokens.toLocaleString()}</span>
            </span>
          </span>
        )}

        {/* Error snippet if failed */}
        {item.error && (
          <span className="rounded bg-status-error-subtle px-1.5 py-0.5 text-[10px] text-status-error-text border border-status-error/20 truncate max-w-xs">
            {`${item.error.code}: ${item.error.message}`}
          </span>
        )}
      </div>
    </div>
  );
}
