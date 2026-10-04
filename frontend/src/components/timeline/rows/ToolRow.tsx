import React from 'react';
import type { ToolItem } from '../../../domain/timeline.types';
import {
  fileBaseName,
  prettyFileName,
  toolCategory,
  toolFilePath,
  toolLineDelta,
  toolVerb,
} from '../../../domain/toolLabels';
import { ChevronRightIcon, LoadingSpinner, XCircleIcon } from '../icons';
import { useExpandState } from '../useExpandState';
import { FileTypeIcon } from './FileTypeIcon';
import { ToolDetail } from './ToolDetail';

export interface ToolRowProps {
  item: ToolItem;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  renderSubagent?: (item: ToolItem['subagents'][number]) => React.ReactNode;
}

function ToolObject({ item }: { item: ToolItem }) {
  const { tool } = item;
  const category = toolCategory(tool.kind);

  if (category === 'command') {
    const command = tool.target ?? tool.name;
    return (
      <code className="min-w-0 truncate font-mono text-xs text-text-secondary" title={command}>
        {command}
      </code>
    );
  }

  if (category === 'edit' || category === 'view') {
    const path = toolFilePath(tool);
    if (path) {
      const delta = category === 'edit' ? toolLineDelta(tool) : null;
      return (
        <span className="flex min-w-0 items-center gap-1" title={path}>
          <FileTypeIcon path={path} />
          <span className="truncate text-text-secondary">
            {category === 'edit' ? prettyFileName(path) : fileBaseName(path)}
          </span>
          {delta && (
            <span className="shrink-0 font-mono text-[11px]" data-testid="line-delta">
              <span className="text-status-success-text">{`+${delta.additions}`}</span>{' '}
              <span className="text-status-error-text">{`-${delta.deletions}`}</span>
            </span>
          )}
        </span>
      );
    }
  }

  const label = tool.target ?? tool.name;
  return (
    <span className="min-w-0 truncate text-text-secondary" title={label}>
      {label}
    </span>
  );
}

/** One compact line per tool call ("Ran npm test", "Edited Fix Name +3 -1"); click for details. */
export function ToolRow({ item, expanded, onExpandedChange, renderSubagent }: ToolRowProps) {
  const { tool } = item;
  const [isExpanded, toggle] = useExpandState(false, expanded, onExpandedChange);
  const running = tool.status === 'running';
  const failed = tool.status === 'failed';
  const category = toolCategory(tool.kind);

  return (
    <div data-testid="tool-row" data-status={tool.status} data-category={category}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isExpanded}
        className="group flex w-full min-w-0 items-center gap-1.5 rounded py-0.5 text-left text-[13px] transition-colors hover:text-text-primary"
        data-testid="tool-row-toggle"
      >
        <span className="shrink-0 text-text-tertiary">{toolVerb(category, running)}</span>
        <ToolObject item={item} />
        {running && <LoadingSpinner className="h-3 w-3 shrink-0 text-text-tertiary" />}
        {failed && (
          <span className="shrink-0 text-status-error-text" title={tool.error ?? 'Failed'}>
            <XCircleIcon className="h-3 w-3" />
          </span>
        )}
        <ChevronRightIcon
          className={`h-3 w-3 shrink-0 text-text-tertiary transition-transform ${
            isExpanded ? 'rotate-90 opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        />
      </button>
      {isExpanded && (
        <div className="pl-3">
          <ToolDetail tool={tool} />
        </div>
      )}
      {renderSubagent && item.subagents.length > 0 && (
        <div className="pl-3">{item.subagents.map((sub) => <React.Fragment key={sub.id}>{renderSubagent(sub)}</React.Fragment>)}</div>
      )}
    </div>
  );
}
