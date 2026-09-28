import React, { useState } from 'react';
import type { ToolCall } from '@agy-studio/contracts';
import { ChevronDownIcon, ChevronRightIcon, GlobeIcon } from '../icons';
import { StatusDot } from '../StatusDot';

export interface BrowserCardProps {
  tool: ToolCall;
  defaultExpanded?: boolean;
  className?: string;
}

export function BrowserCard({
  tool,
  defaultExpanded = false,
  className = '',
}: BrowserCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const input = tool.input || {};
  const action = tool.name.replace(/^browser_/, '') || 'action';
  const target = tool.target || '';

  const screenshot =
    typeof tool.output === 'string' && tool.output.startsWith('data:image/')
      ? tool.output
      : null;

  return (
    <div
      className={`my-1.5 rounded-md border border-border-default bg-bg-surface/50 text-xs transition-colors hover:border-border-strong ${
        tool.status === 'failed' ? 'border-red-500/40 bg-red-950/10' : ''
      } ${className}`}
      data-testid="browser-card"
    >
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-text-secondary hover:text-text-primary transition-colors select-none focus:outline-none"
        aria-expanded={isExpanded}
        data-testid="browser-toggle-btn"
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
            <GlobeIcon className="w-3.5 h-3.5" />
          </span>
          <span className="font-medium text-text-tertiary uppercase text-[10px] tracking-wider shrink-0">
            Browser
          </span>
          <span className="font-mono text-accent truncate">
            {action}
          </span>
          {target && (
            <span
              className="text-text-secondary truncate font-mono text-[11px]"
              title={target}
            >
              {target}
            </span>
          )}
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

          {/* Screenshot preview if available */}
          {screenshot && (
            <div className="space-y-1">
              <div className="text-[10px] font-sans text-text-tertiary uppercase tracking-wider">
                Screenshot Preview
              </div>
              <div className="rounded border border-border-default overflow-hidden bg-black/40 flex items-center justify-center max-h-72">
                <img
                  src={screenshot}
                  alt="Browser snapshot"
                  className="max-h-72 w-auto object-contain"
                />
              </div>
            </div>
          )}

          {/* Details / Arguments */}
          <div>
            <div className="text-[10px] font-sans text-text-tertiary uppercase tracking-wider mb-1">
              Action Details
            </div>
            <pre className="max-h-48 overflow-auto rounded border border-border-default bg-[#0a0d14] p-2 font-mono text-[11px] leading-relaxed text-text-secondary">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>

          {tool.output && !screenshot && (
            <div>
              <div className="text-[10px] font-sans text-text-tertiary uppercase tracking-wider mb-1">
                Result Output
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
