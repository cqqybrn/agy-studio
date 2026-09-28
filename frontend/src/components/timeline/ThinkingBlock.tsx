import React, { useState } from 'react';
import type { ThinkingItem } from '../../domain/timeline.types';
import { ChevronDownIcon, ChevronRightIcon, SparklesIcon, LoadingSpinner } from './icons';
import { StatusDot } from './StatusDot';

export interface ThinkingBlockProps {
  item: ThinkingItem;
  hidden?: boolean;
  defaultExpanded?: boolean;
  className?: string;
}

export function formatThinkingDuration(durationMs: number | null): string | null {
  if (durationMs == null || durationMs < 0) return null;
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  return `${seconds}s`;
}

export function ThinkingBlock({
  item,
  hidden = false,
  defaultExpanded = false,
  className = '',
}: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (hidden) {
    return null;
  }

  const durationStr = formatThinkingDuration(item.durationMs);

  let title: string;
  if (!item.isComplete && !durationStr) {
    title = 'Thinking…';
  } else if (durationStr) {
    title = item.isComplete ? `Thought for ${durationStr}` : `Thinking… (${durationStr})`;
  } else {
    title = item.isComplete ? 'Thought' : 'Thinking…';
  }

  return (
    <div
      className={`my-1.5 rounded-md border border-border-default bg-bg-surface/50 text-xs transition-colors hover:border-border-strong ${className}`}
      data-testid="thinking-block"
      data-complete={item.isComplete ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-text-secondary hover:text-text-primary transition-colors select-none focus:outline-none"
        aria-expanded={isExpanded}
        data-testid="thinking-toggle-btn"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-text-tertiary">
            {isExpanded ? (
              <ChevronDownIcon className="w-3.5 h-3.5" />
            ) : (
              <ChevronRightIcon className="w-3.5 h-3.5" />
            )}
          </span>
          <span className="text-accent flex items-center">
            {!item.isComplete ? (
              <LoadingSpinner className="w-3.5 h-3.5" />
            ) : (
              <SparklesIcon className="w-3.5 h-3.5 text-text-tertiary" />
            )}
          </span>
          <span className="font-medium text-text-secondary truncate tracking-tight">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-2 pl-2 shrink-0">
          {!item.isComplete && <StatusDot status="running" size="sm" />}
        </div>
      </button>

      {isExpanded && (
        <div
          className="border-t border-border-subtle bg-bg-app/40 px-3 py-2.5"
          data-testid="thinking-content"
        >
          {item.text ? (
            <div className="max-h-80 overflow-y-auto text-xs font-mono leading-relaxed text-text-secondary whitespace-pre-wrap break-words select-text">
              {item.text}
            </div>
          ) : (
            <div className="text-xs italic text-text-tertiary">
              {item.isComplete ? 'No thought content recorded.' : 'Generating thoughts…'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
