import React from 'react';
import type { ThinkingItem } from '../../../domain/timeline.types';
import { formatThinkingDuration } from '../ThinkingBlock';
import { ChevronRightIcon, LoadingSpinner } from '../icons';
import { useExpandState } from '../useExpandState';

export interface ThinkingRowProps {
  item: ThinkingItem;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
}

export function ThinkingRow({ item, expanded, onExpandedChange }: ThinkingRowProps) {
  const [isExpanded, toggle] = useExpandState(false, expanded, onExpandedChange);
  const duration = formatThinkingDuration(item.durationMs);
  const title = item.isComplete
    ? duration
      ? `Thought for ${duration}`
      : 'Thought'
    : 'Thinking…';

  return (
    <div data-testid="thinking-row" data-complete={item.isComplete ? 'true' : 'false'}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isExpanded}
        className="group flex items-center gap-1.5 rounded py-0.5 text-left text-xs text-text-tertiary transition-colors hover:text-text-primary"
        data-testid="thinking-row-toggle"
      >
        <span>{title}</span>
        {!item.isComplete && <LoadingSpinner className="h-3 w-3" />}
        <ChevronRightIcon
          className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : 'opacity-60 group-hover:opacity-100'}`}
        />
      </button>
      {isExpanded && (
        <div
          className="mb-1 ml-1 max-h-80 overflow-y-auto whitespace-pre-wrap break-words border-l border-border-subtle pl-3 text-xs leading-relaxed text-text-tertiary"
          data-testid="thinking-row-content"
        >
          {item.text || (item.isComplete ? 'No thought content recorded.' : 'Generating thoughts…')}
        </div>
      )}
    </div>
  );
}
