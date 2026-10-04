import React from 'react';
import type { AssistantMessageItem, UserMessageItem } from '../../../domain/timeline.types';
import { CopyButton } from '../CopyButton';
import { MessageMarkdown } from '../MessageMarkdown';

export function UserMessageRow({ item }: { item: UserMessageItem }) {
  return (
    <div className="py-1.5" data-testid={`timeline-item-user-${item.id}`}>
      <div className="rounded-lg border border-border-default bg-bg-surface px-3.5 py-2.5 text-[15px] leading-7 text-text-primary">
        {item.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {item.attachments.map((att) => (
              <span
                key={att.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-bg-app px-2 py-0.5 text-xs text-text-secondary"
                title={att.originalName}
              >
                <span className="text-text-tertiary">📎</span>
                <span className="max-w-[200px] truncate">{att.originalName}</span>
              </span>
            ))}
          </div>
        )}
        <MessageMarkdown content={item.text} />
      </div>
    </div>
  );
}

/** Small "A Assistant" label, shown once per run above its first row. */
export function AssistantIdentity({ streaming = false }: { streaming?: boolean }) {
  return (
    <div className="mb-1 flex items-center gap-2 pt-2" data-testid="assistant-identity">
      <span className="flex h-5 w-5 select-none items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
        A
      </span>
      <span className="text-sm font-semibold text-text-primary">Assistant</span>
      {streaming && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
    </div>
  );
}

/** Narration and final answers: plain markdown, never collapsed. */
export function AssistantMessageRow({ item }: { item: AssistantMessageItem }) {
  return (
    <div
      className="group/msg relative py-1 pr-14 text-[15px] leading-7 text-text-primary"
      data-testid={`timeline-item-assistant-${item.id}`}
    >
      {item.isComplete && item.text && (
        <div className="absolute right-0 top-1">
          <CopyButton text={item.text} label="复制" testId="copy-message-btn" />
        </div>
      )}
      <MessageMarkdown content={item.text} streaming={!item.isComplete} />
      {!item.isComplete && !item.text && (
        <span className="flex items-center gap-1 text-[11px] text-accent">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          <span>生成中…</span>
        </span>
      )}
    </div>
  );
}
