import React, { useEffect, useRef, useState } from 'react';
import type { AssistantMessageItem, UserMessageItem } from '../../../domain/timeline.types';
import { CopyButton } from '../CopyButton';
import { PencilIcon } from '../icons';
import { MessageMarkdown } from '../MessageMarkdown';

export const EDIT_HINT = '发送后，这条消息之后的回答会全部删除，agy 在那些回答里改过的文件也会还原。';

export interface UserMessageRowProps {
  item: UserMessageItem;
  /** Re-asks with the edited text. Omit to hide editing. */
  onEdit?: (text: string) => Promise<void>;
  /** Why editing is unavailable right now (e.g. a run is active); disables the button. */
  editDisabledReason?: string | null;
}

function AttachmentChips({ item }: { item: UserMessageItem }) {
  if (item.attachments.length === 0) return null;
  return (
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
  );
}

export function UserMessageRow({ item, onEdit, editDisabledReason = null }: UserMessageRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!editing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const startEdit = () => {
    setDraft(item.text);
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    if (saving) return;
    setEditing(false);
    setError(null);
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || !onEdit || saving) return;
    setSaving(true);
    setError(null);
    try {
      // On success the history is reloaded and this row is replaced by the new message.
      await onEdit(text);
      setEditing(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      void submit();
    }
  };

  if (editing) {
    return (
      <div className="py-1.5" data-testid={`timeline-item-user-${item.id}`}>
        <div
          className="rounded-lg border border-accent bg-bg-surface px-3.5 py-2.5 ring-1 ring-accent/40"
          data-testid="user-message-editor"
        >
          <AttachmentChips item={item} />
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={saving}
            rows={Math.min(12, Math.max(3, draft.split('\n').length))}
            className="w-full resize-y bg-transparent text-[15px] leading-7 text-text-primary focus:outline-none disabled:opacity-60"
            data-testid="user-message-edit-textarea"
          />
          {error && (
            <div className="mt-1.5 text-xs text-status-error-text" data-testid="user-message-edit-error">
              编辑失败：{error}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-text-tertiary">{EDIT_HINT}</span>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={cancel}
                disabled={saving}
                className="rounded-md px-3 py-1 text-xs text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary disabled:opacity-40"
                data-testid="user-message-edit-cancel"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={saving || !draft.trim()}
                className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-40"
                data-testid="user-message-edit-submit"
              >
                {saving ? '正在回退…' : '发送'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group/user py-1.5" data-testid={`timeline-item-user-${item.id}`}>
      <div className="rounded-lg border border-border-default bg-bg-surface px-3.5 py-2.5 text-[15px] leading-7 text-text-primary">
        <AttachmentChips item={item} />
        <MessageMarkdown content={item.text} />
      </div>
      {onEdit && (
        <div className="mt-0.5 flex justify-end opacity-0 transition-opacity group-hover/user:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={startEdit}
            disabled={Boolean(editDisabledReason)}
            title={editDisabledReason ?? '编辑并重新提问'}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:bg-bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="user-message-edit-btn"
          >
            <PencilIcon className="h-3 w-3" />
            编辑
          </button>
        </div>
      )}
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
