import React from 'react';
import type { ToolCall } from '@agy-studio/contracts';
import { ChevronDownIcon, ChevronRightIcon, FileCodeIcon } from '../icons';
import { StatusDot } from '../StatusDot';
import { useExpandState } from '../useExpandState';

export interface FileEditCardProps {
  tool: ToolCall;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  className?: string;
}

export function FileEditCard({
  tool,
  defaultExpanded = false,
  expanded,
  onExpandedChange,
  className = '',
}: FileEditCardProps) {
  const [isExpanded, toggleExpanded] = useExpandState(defaultExpanded, expanded, onExpandedChange);

  const input = tool.input || {};
  const filePath = tool.target || tool.fileChanges[0]?.path || tool.name;

  // Extract additions and deletions
  let additions = 0;
  let deletions = 0;
  if (tool.fileChanges && tool.fileChanges.length > 0) {
    for (const fc of tool.fileChanges) {
      if (fc.additions != null) additions += fc.additions;
      if (fc.deletions != null) deletions += fc.deletions;
    }
  } else {
    if (typeof input.additions === 'number') additions = input.additions;
    if (typeof input.deletions === 'number') deletions = input.deletions;
  }

  // Action verb
  let actionLabel = 'Edit';
  if (tool.kind === 'view_file') actionLabel = 'View';
  else if (tool.kind === 'write_file') actionLabel = 'Write';
  else if (tool.fileChanges[0]?.changeType === 'created') actionLabel = 'Create';
  else if (tool.fileChanges[0]?.changeType === 'deleted') actionLabel = 'Delete';

  // Details content: patch / diff / content / old_string & new_string
  const patchContent =
    (input.patch as string) ||
    (input.diff as string) ||
    (input.content as string) ||
    (tool.output as string) ||
    '';

  const hasOldNew = input.old_string !== undefined || input.new_string !== undefined;

  return (
    <div
      className={`my-1.5 rounded-md border border-border-default bg-bg-surface/50 text-xs transition-colors hover:border-border-strong ${
        tool.status === 'failed' ? 'border-status-error/40 bg-status-error-subtle' : ''
      } ${className}`}
      data-testid="file-edit-card"
      data-kind={tool.kind}
    >
      <button
        type="button"
        onClick={toggleExpanded}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-text-secondary hover:text-text-primary transition-colors select-none focus:outline-none"
        aria-expanded={isExpanded}
        data-testid="file-edit-toggle-btn"
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
            <FileCodeIcon className="w-3.5 h-3.5" />
          </span>
          <span className="font-medium text-text-tertiary uppercase text-[10px] tracking-wider shrink-0">
            {actionLabel}
          </span>
          <span className="font-mono text-text-primary truncate" title={filePath}>
            {filePath}
          </span>
        </div>

        <div className="flex items-center gap-2 pl-2 shrink-0">
          {(additions > 0 || deletions > 0) && (
            <div className="flex items-center gap-1 font-mono text-[11px]">
              {additions > 0 && (
                <span className="rounded bg-status-success-subtle px-1 py-0.2 text-status-success-text border border-status-success/20">
                  {`+${additions}`}
                </span>
              )}
              {deletions > 0 && (
                <span className="rounded bg-status-error-subtle px-1 py-0.2 text-status-error-text border border-status-error/20">
                  {`−${deletions}`}
                </span>
              )}
            </div>
          )}
          <StatusDot status={tool.status} size="sm" />
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border-subtle bg-bg-app/40 p-3 space-y-2">
          {tool.error && (
            <div className="rounded bg-status-error-subtle border border-status-error/30 p-2 text-xs font-mono text-status-error-text">
              {tool.error}
            </div>
          )}

          {hasOldNew && (
            <div className="space-y-1.5 font-mono text-xs">
              {input.old_string !== undefined && (
                <div>
                  <div className="text-[10px] font-sans text-status-error-text uppercase tracking-wider mb-0.5">
                    Original Text
                  </div>
                  <pre className="max-h-40 overflow-x-auto rounded border border-status-error/20 bg-status-error-subtle p-2 text-text-secondary whitespace-pre-wrap">
                    {String(input.old_string)}
                  </pre>
                </div>
              )}
              {input.new_string !== undefined && (
                <div>
                  <div className="text-[10px] font-sans text-status-success-text uppercase tracking-wider mb-0.5">
                    Replacement Text
                  </div>
                  <pre className="max-h-40 overflow-x-auto rounded border border-status-success/20 bg-status-success-subtle p-2 text-text-secondary whitespace-pre-wrap">
                    {String(input.new_string)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {patchContent && !hasOldNew && (
            <div>
              <div className="text-[10px] text-text-tertiary uppercase tracking-wider mb-1">
                Patch / Content
              </div>
              <pre className="max-h-60 overflow-auto rounded border border-border-default bg-bg-code p-2.5 font-mono text-xs text-text-secondary leading-relaxed">
                {patchContent.split('\n').map((line, idx) => {
                  let lineClass = 'text-text-secondary';
                  if (line.startsWith('+') && !line.startsWith('+++')) {
                    lineClass = 'text-status-success-text bg-status-success-subtle';
                  } else if (line.startsWith('-') && !line.startsWith('---')) {
                    lineClass = 'text-status-error-text bg-status-error-subtle';
                  } else if (line.startsWith('@@')) {
                    lineClass = 'text-accent';
                  }
                  return (
                    <div key={idx} className={`${lineClass} px-1 rounded-sm`}>
                      {line || ' '}
                    </div>
                  );
                })}
              </pre>
            </div>
          )}

          {!patchContent && !hasOldNew && !tool.error && (
            <div className="text-xs italic text-text-tertiary">
              No additional diff details available.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
