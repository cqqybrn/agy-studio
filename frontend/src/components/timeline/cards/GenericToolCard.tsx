import React, { useState } from 'react';
import type { ToolCall } from '@agy-studio/contracts';
import { ChevronDownIcon, ChevronRightIcon, WrenchIcon } from '../icons';
import { StatusDot } from '../StatusDot';

export interface GenericToolCardProps {
  tool: ToolCall;
  defaultExpanded?: boolean;
  className?: string;
}

export function GenericToolCard({
  tool,
  defaultExpanded = false,
  className = '',
}: GenericToolCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const input = tool.input || {};
  const hasInputs = Object.keys(input).length > 0;

  return (
    <div
      className={`my-1.5 rounded-md border border-border-default bg-bg-surface/50 text-xs transition-colors hover:border-border-strong ${
        tool.status === 'failed' ? 'border-red-500/40 bg-red-950/10' : ''
      } ${className}`}
      data-testid="generic-tool-card"
    >
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
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
            <div className="rounded bg-rose-500/10 border border-rose-500/30 p-2 text-xs font-mono text-rose-300">
              {tool.error}
            </div>
          )}

          {hasInputs && (
            <div>
              <div className="text-[10px] font-sans text-text-tertiary uppercase tracking-wider mb-1">
                Inputs
              </div>
              <pre className="max-h-48 overflow-auto rounded border border-border-default bg-[#0a0d14] p-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}

          {tool.output && (
            <div>
              <div className="text-[10px] font-sans text-text-tertiary uppercase tracking-wider mb-1">
                Output
              </div>
              <pre className="max-h-48 overflow-auto rounded border border-border-default bg-[#0a0d14] p-2 font-mono text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap">
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
