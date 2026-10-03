import React from 'react';
import type { ToolCall } from '@agy-studio/contracts';
import { ChevronDownIcon, ChevronRightIcon, CpuIcon } from '../icons';
import { StatusDot } from '../StatusDot';
import { useExpandState } from '../useExpandState';

export interface McpCardProps {
  tool: ToolCall;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  className?: string;
}

export function McpCard({
  tool,
  defaultExpanded = false,
  expanded,
  onExpandedChange,
  className = '',
}: McpCardProps) {
  const [isExpanded, toggleExpanded] = useExpandState(defaultExpanded, expanded, onExpandedChange);

  // MCP tool names often follow mcp__<server>__<method> or <server>:<tool>
  let serverName = '';
  let methodName = tool.name;

  if (tool.name.startsWith('mcp__')) {
    const parts = tool.name.split('__');
    if (parts.length >= 3) {
      serverName = parts[1];
      methodName = parts.slice(2).join('__');
    }
  } else if (tool.name.includes(':')) {
    const parts = tool.name.split(':');
    serverName = parts[0];
    methodName = parts[1];
  } else if (typeof tool.input?.server === 'string') {
    serverName = tool.input.server;
  }

  const input = tool.input || {};

  return (
    <div
      className={`my-1.5 rounded-md border border-border-default bg-bg-surface/50 text-xs transition-colors hover:border-border-strong ${
        tool.status === 'failed' ? 'border-status-error/40 bg-status-error-subtle' : ''
      } ${className}`}
      data-testid="mcp-card"
    >
      <button
        type="button"
        onClick={toggleExpanded}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-text-secondary hover:text-text-primary transition-colors select-none focus:outline-none"
        aria-expanded={isExpanded}
        data-testid="mcp-toggle-btn"
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
            <CpuIcon className="w-3.5 h-3.5" />
          </span>
          <span className="font-medium text-text-tertiary uppercase text-[10px] tracking-wider shrink-0">
            MCP
          </span>
          {serverName && (
            <span className="rounded bg-accent/10 px-1 py-0.2 font-mono text-[11px] text-accent border border-accent/20 truncate">
              {serverName}
            </span>
          )}
          <span className="font-mono text-text-primary truncate">
            {methodName}
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

          <div>
            <div className="text-[10px] font-sans text-text-tertiary uppercase tracking-wider mb-1">
              Parameters
            </div>
            <pre className="max-h-48 overflow-auto rounded border border-border-default bg-bg-code p-2 font-mono text-[11px] leading-relaxed text-text-secondary">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>

          {tool.output && (
            <div>
              <div className="text-[10px] font-sans text-text-tertiary uppercase tracking-wider mb-1">
                Response
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
