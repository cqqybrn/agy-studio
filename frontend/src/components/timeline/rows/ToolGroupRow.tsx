import React from 'react';
import type { SubagentItem, ToolItem } from '../../../domain/timeline.types';
import { toolGroupLabel, type ToolCategory } from '../../../domain/toolLabels';
import { ChevronRightIcon, LoadingSpinner, XCircleIcon } from '../icons';
import { useExpandState } from '../useExpandState';
import { ToolRow } from './ToolRow';

export interface ToolGroupRowProps {
  category: ToolCategory;
  tools: ToolItem[];
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  /** Expand choices for the tools inside, keyed by toolCallId. */
  toolExpanded?: Readonly<Record<string, boolean>>;
  onToolExpandedChange?: (toolCallId: string, next: boolean) => void;
  renderSubagent?: (item: SubagentItem) => React.ReactNode;
}

/** Adjacent tools of one category collapsed into "Ran 3 commands"; expands into ToolRows. */
export function ToolGroupRow({
  category,
  tools,
  expanded,
  onExpandedChange,
  toolExpanded,
  onToolExpandedChange,
  renderSubagent,
}: ToolGroupRowProps) {
  const [isExpanded, toggle] = useExpandState(false, expanded, onExpandedChange);
  const running = tools.some((t) => t.tool.status === 'running');
  const failedCount = tools.filter((t) => t.tool.status === 'failed').length;

  return (
    <div data-testid="tool-group-row" data-category={category}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isExpanded}
        className="group flex items-center gap-1.5 rounded py-0.5 text-left text-[13px] text-text-tertiary transition-colors hover:text-text-primary"
        data-testid="tool-group-toggle"
      >
        <span>{toolGroupLabel(category, tools.length, running)}</span>
        {running && <LoadingSpinner className="h-3 w-3" />}
        {failedCount > 0 && (
          <span className="flex items-center gap-0.5 text-status-error-text" title={`${failedCount} failed`}>
            <XCircleIcon className="h-3 w-3" />
            {failedCount > 1 && <span className="text-[10px]">{failedCount}</span>}
          </span>
        )}
        <ChevronRightIcon
          className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : 'opacity-60 group-hover:opacity-100'}`}
        />
      </button>
      {isExpanded && (
        <div className="ml-1 border-l border-border-subtle pl-3" data-testid="tool-group-children">
          {tools.map((t) => (
            <ToolRow
              key={t.toolCallId}
              item={t}
              expanded={toolExpanded?.[t.toolCallId]}
              onExpandedChange={
                onToolExpandedChange ? (next) => onToolExpandedChange(t.toolCallId, next) : undefined
              }
              renderSubagent={renderSubagent}
            />
          ))}
        </div>
      )}
    </div>
  );
}
