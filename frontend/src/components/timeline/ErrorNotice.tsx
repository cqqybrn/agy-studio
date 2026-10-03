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
    ? 'border-status-warning/40 bg-status-warning-subtle text-status-warning-text'
    : 'border-status-error/40 bg-status-error-subtle text-status-error-text';

  const badgeColor = isRetryable
    ? 'border-status-warning/30 bg-status-warning-subtle text-status-warning-text'
    : 'border-status-error/30 bg-status-error-subtle text-status-error-text';

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
              <span className="rounded bg-status-warning-subtle px-1.5 py-0.5 text-[10px] text-status-warning-text font-sans border border-status-warning/20">
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
                <pre className="mt-2 max-h-40 overflow-auto rounded border border-border-default bg-bg-code p-2 font-mono text-[10px] text-text-secondary leading-relaxed whitespace-pre-wrap">
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
