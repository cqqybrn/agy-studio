import React, { useState } from 'react';
import type { ToolCall } from '@agy-studio/contracts';
import { ChevronDownIcon, ChevronRightIcon, FileCodeIcon } from '../icons';
import { StatusDot } from '../StatusDot';

export interface FileEditCardProps {
  tool: ToolCall;
  defaultExpanded?: boolean;
  className?: string;
}

export function FileEditCard({
  tool,
  defaultExpanded = false,
  className = '',
}: FileEditCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

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
        tool.status === 'failed' ? 'border-red-500/40 bg-red-950/10' : ''
      } ${className}`}
      data-testid="file-edit-card"
      data-kind={tool.kind}
    >
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
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
                <span className="rounded bg-emerald-500/10 px-1 py-0.2 text-emerald-400 border border-emerald-500/20">
                  {`+${additions}`}
                </span>
              )}
              {deletions > 0 && (
                <span className="rounded bg-rose-500/10 px-1 py-0.2 text-rose-400 border border-rose-500/20">
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
            <div className="rounded bg-rose-500/10 border border-rose-500/30 p-2 text-xs font-mono text-rose-300">
              {tool.error}
            </div>
          )}

          {hasOldNew && (
            <div className="space-y-1.5 font-mono text-xs">
              {input.old_string !== undefined && (
                <div>
                  <div className="text-[10px] font-sans text-rose-400 uppercase tracking-wider mb-0.5">
                    Original Text
                  </div>
                  <pre className="max-h-40 overflow-x-auto rounded border border-rose-500/20 bg-rose-950/20 p-2 text-text-secondary whitespace-pre-wrap">
                    {String(input.old_string)}
                  </pre>
                </div>
              )}
              {input.new_string !== undefined && (
                <div>
                  <div className="text-[10px] font-sans text-emerald-400 uppercase tracking-wider mb-0.5">
                    Replacement Text
                  </div>
                  <pre className="max-h-40 overflow-x-auto rounded border border-emerald-500/20 bg-emerald-950/20 p-2 text-text-secondary whitespace-pre-wrap">
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
              <pre className="max-h-60 overflow-auto rounded border border-border-default bg-[#0a0d14] p-2.5 font-mono text-xs text-text-secondary leading-relaxed">
                {patchContent.split('\n').map((line, idx) => {
                  let lineClass = 'text-text-secondary';
                  if (line.startsWith('+') && !line.startsWith('+++')) {
                    lineClass = 'text-emerald-400 bg-emerald-500/10';
                  } else if (line.startsWith('-') && !line.startsWith('---')) {
                    lineClass = 'text-rose-400 bg-rose-500/10';
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
