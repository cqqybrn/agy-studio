import React, { useState } from 'react';
import type { ToolCall } from '@agy-studio/contracts';
import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from '../icons';
import { StatusDot } from '../StatusDot';

export interface SearchCardProps {
  tool: ToolCall;
  defaultExpanded?: boolean;
  className?: string;
}

export function SearchCard({
  tool,
  defaultExpanded = false,
  className = '',
}: SearchCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const input = tool.input || {};
  const query =
    (input.query as string) ||
    (input.pattern as string) ||
    (input.searchTerm as string) ||
    (input.keyword as string) ||
    '';
  const path = (input.path as string) || (input.target_directory as string) || '';

  // Calculate result statistics
  const rawOutput = tool.output || '';
  const lines = rawOutput ? rawOutput.trim().split(/\r?\n/) : [];

  // Look for match counts in output or lines
  let resultCountText = '';
  if (lines.length > 0) {
    resultCountText = `${lines.length} result${lines.length === 1 ? '' : 's'}`;
  } else if (tool.status === 'succeeded') {
    resultCountText = '0 results';
  }

  return (
    <div
      className={`my-1.5 rounded-md border border-border-default bg-bg-surface/50 text-xs transition-colors hover:border-border-strong ${
        tool.status === 'failed' ? 'border-red-500/40 bg-red-950/10' : ''
      } ${className}`}
      data-testid="search-card"
    >
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-text-secondary hover:text-text-primary transition-colors select-none focus:outline-none"
        aria-expanded={isExpanded}
        data-testid="search-toggle-btn"
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
            <SearchIcon className="w-3.5 h-3.5" />
          </span>
          <span className="font-medium text-text-tertiary uppercase text-[10px] tracking-wider shrink-0">
            Search
          </span>
          <span className="font-mono text-text-primary truncate" title={query}>
            &quot;{query || 'all'}&quot;
          </span>
          {path && (
            <span
              className="text-text-tertiary truncate font-mono text-[11px]"
              title={path}
            >
              in {path}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 pl-2 shrink-0">
          {resultCountText && (
            <span className="rounded bg-bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-secondary border border-border-subtle">
              {resultCountText}
            </span>
          )}
          <StatusDot status={tool.status} size="sm" />
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border-subtle bg-bg-app/40 p-3">
          {tool.error && (
            <div className="mb-2 rounded bg-rose-500/10 border border-rose-500/30 p-2 text-xs font-mono text-rose-300">
              {tool.error}
            </div>
          )}

          {rawOutput ? (
            <pre className="max-h-60 overflow-auto rounded border border-border-default bg-[#0a0d14] p-2.5 font-mono text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-all">
              {rawOutput}
            </pre>
          ) : (
            <div className="text-xs italic text-text-tertiary">
              {tool.status === 'running'
                ? 'Searching codebase…'
                : 'No results found.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
