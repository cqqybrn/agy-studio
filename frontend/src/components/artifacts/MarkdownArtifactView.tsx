import React, { useRef, useState } from 'react';
import { useSessionStore } from '../../stores/session.store';
import { MessageMarkdown } from '../timeline/MessageMarkdown';
import { LoadingSpinner } from '../timeline/icons';

export function formatPlanComment(selectedText: string, comment: string): string {
  return `针对实施计划中的"${selectedText}"：${comment}`;
}

export interface MarkdownArtifactViewProps {
  content: string;
  sessionId?: string | null;
  isPlan?: boolean;
  loading?: boolean;
  isHighlighted?: boolean;
  className?: string;
  onSendComment?: (message: string) => Promise<unknown> | void;
}

export function MarkdownArtifactView({
  content = '',
  sessionId = null,
  isPlan = false,
  loading = false,
  isHighlighted = false,
  className = '',
  onSendComment,
}: MarkdownArtifactViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedText, setSelectedText] = useState('');
  const [floatingPos, setFloatingPos] = useState<{ top: number; left: number } | null>(null);
  const [isInputOpen, setIsInputOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleMouseUp = () => {
    if (!isPlan || typeof window === 'undefined') return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      if (!isInputOpen) {
        setFloatingPos(null);
        setSelectedText('');
      }
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      if (!isInputOpen) {
        setFloatingPos(null);
        setSelectedText('');
      }
      return;
    }

    if (containerRef.current) {
      try {
        const range = selection.getRangeAt(0);
        if (containerRef.current.contains(range.commonAncestorContainer)) {
          const rect = range.getBoundingClientRect();
          const containerRect = containerRef.current.getBoundingClientRect();
          setSelectedText(text);
          setFloatingPos({
            top: Math.max(8, rect.top - containerRect.top + containerRef.current.scrollTop - 42),
            left: Math.max(8, Math.min(containerRect.width - 240, rect.left - containerRect.left)),
          });
        }
      } catch {
        // ignore range error
      }
    }
  };

  const handleOpenComment = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsInputOpen(true);
  };

  const handleCloseComment = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsInputOpen(false);
    setFloatingPos(null);
    setSelectedText('');
    setCommentText('');
  };

  const handleSendComment = async (customComment?: string) => {
    const finalComment = customComment !== undefined ? customComment : commentText;
    if (!selectedText) return;

    const message = formatPlanComment(selectedText, finalComment.trim() || '请优化此处');
    setIsSending(true);

    try {
      if (onSendComment) {
        await onSendComment(message);
      } else if (sessionId) {
        await useSessionStore.getState().send(sessionId, message);
      }
      handleCloseComment();
      if (typeof window !== 'undefined') {
        window.getSelection()?.removeAllRanges();
      }
    } finally {
      setIsSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 text-text-tertiary">
        <LoadingSpinner className="h-5 w-5 animate-spin text-accent" />
        <span className="text-xs">加载内容中...</span>
      </div>
    );
  }

  if (!content.trim()) {
    return (
      <div
        className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-border-default p-6 text-center text-text-tertiary"
        data-testid="markdown-empty-state"
      >
        <span className="text-sm">暂无内容</span>
        <span className="mt-1 text-xs text-text-tertiary">
          {isPlan ? '运行过程中将生成实施计划' : '运行结束后将生成完成总结 Walkthrough'}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseUp={handleMouseUp}
      className={`relative flex flex-col p-4 text-xs transition-colors duration-500 ${
        isHighlighted
          ? 'rounded-lg bg-status-warning-subtle ring-2 ring-status-warning/60'
          : ''
      } ${className}`}
      data-testid="markdown-artifact-view"
      data-highlighted={isHighlighted ? 'true' : 'false'}
    >
      {/* 刷新通知标牌 */}
      {isHighlighted && (
        <div className="mb-3 flex items-center justify-between rounded bg-status-warning-subtle px-3 py-1 text-status-warning-text">
          <span className="font-medium">内容刚刚已刷新</span>
          <span className="font-mono text-[10px]">实时同步</span>
        </div>
      )}

      {/* Plan 专属提示 */}
      {isPlan && (
        <div className="mb-3 rounded border border-border-subtle bg-bg-surface px-2.5 py-1.5 text-[11px] text-text-tertiary">
          💡 提示：划选任意段落或代码，可直接针对该部分发起评论与反馈。
        </div>
      )}

      {/* 划词浮层：按钮或输入框 */}
      {isPlan && floatingPos && selectedText && (
        <div
          style={{ top: `${floatingPos.top}px`, left: `${floatingPos.left}px` }}
          className="absolute z-30 transition-all"
          data-testid="plan-selection-popover"
        >
          {!isInputOpen ? (
            <button
              type="button"
              onClick={handleOpenComment}
              className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground shadow-lg hover:bg-accent-hover focus:outline-none"
              data-testid="plan-comment-btn"
            >
              <span>💬</span>
              <span>评论</span>
            </button>
          ) : (
            <div
              className="w-72 rounded-lg border border-border-default bg-bg-panel p-3 shadow-xl backdrop-blur-md"
              data-testid="plan-comment-card"
            >
              <div className="flex items-center justify-between border-b border-border-default pb-1.5">
                <span className="font-medium text-text-primary">针对选中文本评论</span>
                <button
                  type="button"
                  onClick={handleCloseComment}
                  className="rounded p-0.5 text-text-tertiary hover:text-text-primary"
                  title="关闭"
                >
                  ✕
                </button>
              </div>

              <div className="my-2 max-h-12 overflow-hidden text-ellipsis rounded bg-bg-surface p-1.5 text-[11px] text-text-tertiary italic">
                "{selectedText}"
              </div>

              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleSendComment();
                  }
                }}
                placeholder="输入评论或调整要求，回车发送..."
                autoFocus
                className="w-full rounded border border-border-default bg-bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none"
                data-testid="plan-comment-input"
              />

              <div className="mt-2.5 flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={handleCloseComment}
                  className="rounded px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-surface"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={isSending}
                  onClick={() => void handleSendComment()}
                  className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
                  data-testid="plan-comment-submit-btn"
                >
                  {isSending ? '发送中...' : '发送'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Markdown 渲染正文 */}
      <div className="prose prose-invert max-w-none text-xs text-text-primary">
        <MessageMarkdown content={content} />
      </div>
    </div>
  );
}
