import React from 'react';
import type { ToolCall } from '@agy-studio/contracts';
import { ChevronDownIcon, ChevronRightIcon, WrenchIcon } from '../icons';
import { StatusDot } from '../StatusDot';
import { useExpandState } from '../useExpandState';

export interface GenericToolCardProps {
  tool: ToolCall;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  className?: string;
}

export function GenericToolCard({
  tool,
  defaultExpanded = false,
  expanded,
  onExpandedChange,
  className = '',
}: GenericToolCardProps) {
  const [isExpanded, toggleExpanded] = useExpandState(defaultExpanded, expanded, onExpandedChange);

  const input = tool.input || {};
  const hasInputs = Object.keys(input).length > 0;

  return (
    <div
      className={`my-1.5 rounded-md border border-border-default bg-bg-surface/50 text-xs transition-colors hover:border-border-strong ${
        tool.status === 'failed' ? 'border-status-error/40 bg-status-error-subtle' : ''
      } ${className}`}
      data-testid="generic-tool-card"
    >
      <button
        type="button"
        onClick={toggleExpanded}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-text-secondary hover:text-text-primary transition-colors select-none focus:outline-none"
        aria-expanded={isExpanded}
        data-testid="generic-toggle-btn"
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
            <WrenchIcon className="w-3.5 h-3.5" />
          </span>
          <span className="font-medium text-text-tertiary uppercase text-[10px] tracking-wider shrink-0">
            {tool.kind}
          </span>
          <span className="font-mono text-text-primary truncate">
            {tool.name}
          </span>
        </div>

        <div className="flex items-center gap-2 pl-2 shrink-0">
          <StatusDot status={tool.status} size="sm" />
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border-subtle bg-bg-app/40 p-3 space-y-3">
          {tool.error && (
            <div className="rounded bg-status-error-subtle border border-status-error/30 p-2 text-xs font-mono text-status-error-text">
              {tool.error}
            </div>
          )}

          {hasInputs && (
            <div>
              <div className="text-[10px] font-sans text-text-tertiary uppercase tracking-wider mb-1">
                Inputs
              </div>
              <pre className="max-h-48 overflow-auto rounded border border-border-default bg-bg-code p-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}

          {tool.output && (
            <div>
              <div className="text-[10px] font-sans text-text-tertiary uppercase tracking-wider mb-1">
                Output
              </div>
              <pre className="max-h-48 overflow-auto rounded border border-border-default bg-bg-code p-2 font-mono text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap">
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
