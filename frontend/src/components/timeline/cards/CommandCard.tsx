import React, { useState } from 'react';
import type { ToolCall } from '@agy-studio/contracts';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  TerminalIcon,
} from '../icons';
import { StatusDot } from '../StatusDot';

export interface CommandCardProps {
  tool: ToolCall;
  defaultExpanded?: boolean;
  maxInitialLines?: number;
  className?: string;
}

export function CommandCard({
  tool,
  defaultExpanded = true,
  maxInitialLines = 20,
  className = '',
}: CommandCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isAllLinesExpanded, setIsAllLinesExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const input = tool.input || {};
  const command =
    (input.command as string) ||
    (input.cmd as string) ||
    (input.script as string) ||
    tool.name;

  const rawOutput = tool.output || tool.error || '';
  const lines = rawOutput ? rawOutput.split(/\r?\n/) : [];
  const hasMoreLines = lines.length > maxInitialLines;
  const displayedLines = isAllLinesExpanded ? lines : lines.slice(0, maxInitialLines);

  const isFailed = tool.status === 'failed' || Boolean(tool.error);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className={`my-1.5 rounded-md border bg-bg-surface/50 text-xs transition-colors ${
        isFailed
          ? 'border-red-500/50 bg-red-950/10 shadow-[0_0_10px_rgba(239,68,68,0.06)]'
          : 'border-border-default hover:border-border-strong'
      } ${className}`}
      data-testid="command-card"
      data-status={tool.status}
    >
      {/* Header */}
      <div
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-text-secondary hover:text-text-primary transition-colors select-none"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        data-testid="command-toggle-btn"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-text-tertiary shrink-0">
            {isExpanded ? (
              <ChevronDownIcon className="w-3.5 h-3.5" />
            ) : (
              <ChevronRightIcon className="w-3.5 h-3.5" />
            )}
          </span>
          <span
            className={`shrink-0 ${
              isFailed ? 'text-rose-400' : 'text-text-tertiary'
            }`}
          >
            <TerminalIcon className="w-3.5 h-3.5" />
          </span>
          <span className="font-mono text-text-primary truncate" title={command}>
            <span className="text-text-tertiary select-none mr-1">$</span>
            {command}
          </span>
        </div>

        <div className="flex items-center gap-2 pl-2 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            title="Copy command"
            className="rounded p-1 text-text-tertiary hover:bg-bg-surface hover:text-text-primary transition-colors"
          >
            {copied ? (
              <CheckIcon className="w-3 h-3 text-emerald-400" />
            ) : (
              <CopyIcon className="w-3 h-3" />
            )}
          </button>
          <StatusDot status={tool.status} size="sm" />
        </div>
      </div>

      {/* Terminal Output Body */}
      {isExpanded && (
        <div className="border-t border-border-subtle bg-[#080a0f] p-3 rounded-b-md">
          {lines.length > 0 ? (
            <div className="space-y-1">
              <pre className="font-mono text-[11px] leading-relaxed text-text-secondary overflow-x-auto whitespace-pre-wrap break-all">
                {displayedLines.map((line, idx) => (
                  <div key={idx} className="flex">
                    <span className="w-6 shrink-0 select-none text-[10px] text-text-tertiary text-right pr-2">
                      {idx + 1}
                    </span>
                    <span
                      className={
                        isFailed && idx === lines.length - 1
                          ? 'text-rose-400 font-semibold'
                          : ''
                      }
                    >
                      {line || ' '}
                    </span>
                  </div>
                ))}
              </pre>

              {hasMoreLines && (
                <div className="pt-2 border-t border-border-subtle/40 flex justify-between items-center text-[11px]">
                  <span className="text-text-tertiary">
                    Showing {displayedLines.length} of {lines.length} lines
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsAllLinesExpanded((prev) => !prev);
                    }}
                    className="font-mono text-accent hover:text-accent-hover transition-colors underline focus:outline-none"
                    data-testid="expand-lines-btn"
                  >
                    {isAllLinesExpanded
                      ? 'Collapse to 20 lines'
                      : `Expand all (${lines.length} lines)`}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="font-mono text-xs italic text-text-tertiary">
              {tool.status === 'running'
                ? 'Running command…'
                : '(No output returned)'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
