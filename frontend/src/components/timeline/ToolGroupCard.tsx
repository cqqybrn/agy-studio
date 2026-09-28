import React, { useState } from 'react';
import type { ToolGroupItem } from '../../domain/timeline.types';
import { ChevronDownIcon, ChevronRightIcon, LayersIcon } from './icons';
import { StatusDot } from './StatusDot';
import { ToolCard } from './ToolCard';

export interface ToolGroupCardProps {
  item: ToolGroupItem;
  defaultExpanded?: boolean;
  className?: string;
}

export function formatGroupSummary(tools: ToolGroupItem['tools']): string {
  if (!tools || tools.length === 0) {
    return '0 tools';
  }

  let fileViews = 0;
  let searches = 0;
  let others = 0;

  for (const t of tools) {
    const kind = t.tool?.kind;
    if (kind === 'view_file') {
      fileViews++;
    } else if (kind === 'search') {
      searches++;
    } else {
      others++;
    }
  }

  const parts: string[] = [];
  if (fileViews > 0) {
    parts.push(`Viewed ${fileViews} ${fileViews === 1 ? 'file' : 'files'}`);
  }
  if (searches > 0) {
    parts.push(`${searches} ${searches === 1 ? 'search' : 'searches'}`);
  }
  if (others > 0) {
    parts.push(`${others} other tool${others === 1 ? '' : 's'}`);
  }

  return parts.length > 0 ? parts.join(', ') : `${tools.length} tool calls`;
}

export function ToolGroupCard({
  item,
  defaultExpanded = false,
  className = '',
}: ToolGroupCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const tools = item.tools || [];
  const summaryText = formatGroupSummary(tools);

  // Derive group status
  let groupStatus: 'running' | 'succeeded' | 'failed' = 'succeeded';
  if (tools.some((t) => t.tool?.status === 'failed')) {
    groupStatus = 'failed';
  } else if (tools.some((t) => t.tool?.status === 'running')) {
    groupStatus = 'running';
  }

  return (
    <div
      className={`my-1.5 rounded-md border border-border-default bg-bg-surface/30 text-xs transition-colors hover:border-border-strong ${
        groupStatus === 'failed' ? 'border-red-500/30 bg-red-950/5' : ''
      } ${className}`}
      data-testid="tool-group-card"
    >
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-text-secondary hover:text-text-primary transition-colors select-none focus:outline-none"
        aria-expanded={isExpanded}
        data-testid="tool-group-toggle-btn"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-text-tertiary shrink-0">
            {isExpanded ? (
              <ChevronDownIcon className="w-3.5 h-3.5" />
            ) : (
              <ChevronRightIcon className="w-3.5 h-3.5" />
            )}
          </span>
          <span className="text-text-tertiary shrink-0">
            <LayersIcon className="w-3.5 h-3.5" />
          </span>
          <span className="font-medium text-text-primary truncate">
            {summaryText}
          </span>
        </div>

        <div className="flex items-center gap-2 pl-2 shrink-0">
          <span className="rounded bg-bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary border border-border-subtle">
            {tools.length}
          </span>
          <StatusDot status={groupStatus} size="sm" />
        </div>
      </button>

      {isExpanded && (
        <div
          className="border-t border-border-subtle bg-bg-app/30 p-2.5 space-y-1.5"
          data-testid="tool-group-contents"
        >
          {tools.length > 0 ? (
            tools.map((subTool) => (
              <ToolCard
                key={subTool.id || subTool.toolCallId}
                item={subTool}
                defaultExpanded={false}
              />
            ))
          ) : (
            <div className="text-xs italic text-text-tertiary px-2 py-1">
              No tools in this group.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
