import React from 'react';
import type { SubagentItem } from '../../../domain/timeline.types';
import { formatWorkedDuration, type WorkedChild, type WorkedRow } from '../../../domain/displayRows';
import { ChevronRightIcon, LoadingSpinner, XCircleIcon } from '../icons';
import { useExpandState } from '../useExpandState';
import { ThinkingRow } from './ThinkingRow';
import { ToolGroupRow } from './ToolGroupRow';
import { ToolRow } from './ToolRow';
import { useNow } from './useNow';

export interface WorkedBlockProps {
  row: WorkedRow;
  /** Expand choices keyed by block key, group key, toolCallId or thinking id. */
  expandedChoices?: Readonly<Record<string, boolean>>;
  onExpandedChange?: (key: string, next: boolean) => void;
  renderSubagent?: (item: SubagentItem) => React.ReactNode;
}

function WorkedChildRow({
  child,
  expandedChoices,
  onExpandedChange,
  renderSubagent,
}: { child: WorkedChild } & Omit<WorkedBlockProps, 'row'>) {
  const choiceProps = (key: string) => ({
    expanded: expandedChoices?.[key],
    onExpandedChange: onExpandedChange ? (next: boolean) => onExpandedChange(key, next) : undefined,
  });

  switch (child.kind) {
    case 'tool':
      return <ToolRow item={child.item} {...choiceProps(child.key)} renderSubagent={renderSubagent} />;
    case 'tool_group':
      return (
        <ToolGroupRow
          category={child.category}
          tools={child.tools}
          {...choiceProps(child.key)}
          toolExpanded={expandedChoices}
          onToolExpandedChange={onExpandedChange}
          renderSubagent={renderSubagent}
        />
      );
    case 'thinking':
      return <ThinkingRow item={child.item} {...choiceProps(child.key)} />;
    case 'subagent':
      return <>{renderSubagent?.(child.item)}</>;
  }
}

/** "Worked for 42s" — collapsible run of tools/thinking between two messages. */
export function WorkedBlock({ row, expandedChoices, onExpandedChange, renderSubagent }: WorkedBlockProps) {
  const [isExpanded, toggle] = useExpandState(
    row.active,
    expandedChoices?.[row.key],
    onExpandedChange ? (next) => onExpandedChange(row.key, next) : undefined,
  );
  const now = useNow(row.active);
  const start = Date.parse(row.startedAt);
  const end = row.endedAt ? Date.parse(row.endedAt) : now;
  const duration = formatWorkedDuration(Number.isFinite(start) ? end - start : 0);

  return (
    <div data-testid="worked-block" data-active={row.active ? 'true' : 'false'}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isExpanded}
        className="group flex items-center gap-1.5 rounded py-0.5 text-left text-[13px] text-text-tertiary transition-colors hover:text-text-primary"
        data-testid="worked-toggle"
      >
        {row.active && <LoadingSpinner className="h-3 w-3" />}
        <span>{row.active ? `Working… ${duration}` : `Worked for ${duration}`}</span>
        {row.failed && (
          <span className="text-status-error-text" title="Some steps failed">
            <XCircleIcon className="h-3 w-3" />
          </span>
        )}
        {row.children.length > 0 && (
          <ChevronRightIcon
            className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : 'opacity-60 group-hover:opacity-100'}`}
          />
        )}
      </button>
      {isExpanded && row.children.length > 0 && (
        <div className="ml-1 mt-0.5 border-l border-border-subtle pl-3" data-testid="worked-children">
          {row.children.map((child) => (
            <WorkedChildRow
              key={child.key}
              child={child}
              expandedChoices={expandedChoices}
              onExpandedChange={onExpandedChange}
              renderSubagent={renderSubagent}
            />
          ))}
        </div>
      )}
    </div>
  );
}
