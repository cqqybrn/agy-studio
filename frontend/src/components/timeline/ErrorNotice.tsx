import React, { useState } from 'react';
import type { ErrorItem } from '../../domain/timeline.types';
import { AlertTriangleIcon, ChevronDownIcon, ChevronRightIcon } from './icons';

export interface ErrorNoticeProps {
  item: ErrorItem;
  className?: string;
}

export function ErrorNotice({ item, className = '' }: ErrorNoticeProps) {
  const [showDetails, setShowDetails] = useState(false);
  const error = item.error;
  const isRetryable = Boolean(error.retryable);
  const hasDetails = Boolean(error.details && Object.keys(error.details).length > 0);

  const bannerColor = isRetryable
    ? 'border-amber-500/40 bg-amber-950/20 text-amber-200'
    : 'border-rose-500/40 bg-rose-950/20 text-rose-200';

  const badgeColor = isRetryable
    ? 'border-amber-500/30 bg-amber-500/15 text-amber-300'
    : 'border-rose-500/30 bg-rose-500/15 text-rose-300';

  return (
    <div
      className={`my-2.5 rounded-lg border p-3 text-xs shadow-sm transition-colors ${bannerColor} ${className}`}
      data-testid="error-notice"
      data-code={error.code}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0">
          <AlertTriangleIcon className="w-4 h-4 text-current opacity-90" />
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider border ${badgeColor}`}
            >
              {error.code}
            </span>
            {isRetryable && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400 font-sans border border-amber-500/20">
                可重试 / Retryable
              </span>
            )}
          </div>

          <div className="leading-relaxed text-text-primary font-medium break-words">
            {error.message}
          </div>

          {hasDetails && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowDetails((prev) => !prev)}
                className="inline-flex items-center gap-1 font-mono text-[11px] text-text-tertiary hover:text-text-primary transition-colors focus:outline-none"
                data-testid="error-details-toggle"
              >
                {showDetails ? (
                  <ChevronDownIcon className="w-3 h-3" />
                ) : (
                  <ChevronRightIcon className="w-3 h-3" />
                )}
                <span>{showDetails ? 'Hide details' : 'Show technical details'}</span>
              </button>

              {showDetails && (
                <pre className="mt-2 max-h-40 overflow-auto rounded border border-border-default bg-[#0a0d14] p-2 font-mono text-[10px] text-text-secondary leading-relaxed whitespace-pre-wrap">
                  {JSON.stringify(error.details, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
