import React from 'react';
import type { AttachmentChipProps } from './types';
import { formatFileSize } from './compress';

export function AttachmentChip({
  attachment,
  onDelete,
  onRetry,
  disabled = false,
  className = '',
}: AttachmentChipProps) {
  const isImage = attachment.mimeType.startsWith('image/');
  const isUploading = attachment.status === 'uploading' || attachment.status === 'compressing';
  const isError = attachment.status === 'error';

  return (
    <div
      data-testid={`attachment-chip-${attachment.id}`}
      className={`group relative inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors select-none ${
        isError
          ? 'border-red-500/50 bg-red-950/20 text-red-300'
          : isUploading
          ? 'border-border-default bg-bg-surface text-text-secondary'
          : 'border-border-default bg-bg-surface text-text-primary hover:border-border-strong'
      } ${className}`}
    >
      {/* Icon: image or file */}
      <span className="shrink-0 text-text-tertiary group-hover:text-text-secondary">
        {isImage ? (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        )}
      </span>

      {/* Filename & size/progress/status */}
      <div className="flex items-center gap-1.5 min-w-0 max-w-[180px]">
        <span className="truncate font-medium" title={attachment.originalName}>
          {attachment.originalName}
        </span>
        <span className="shrink-0 text-[10px] text-text-tertiary">
          {isUploading ? (
            attachment.status === 'compressing' ? (
              <span className="text-accent animate-pulse">压缩中…</span>
            ) : (
              <span className="text-accent font-mono">{attachment.progress}%</span>
            )
          ) : isError ? (
            <span className="text-red-400 font-medium">失败</span>
          ) : (
            <span>({formatFileSize(attachment.size)})</span>
          )}
        </span>
      </div>

      {/* Error Retry Button */}
      {isError && onRetry && (
        <button
          type="button"
          data-testid={`retry-attachment-${attachment.id}`}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onRetry(attachment.id);
          }}
          className="ml-0.5 rounded p-0.5 text-red-400 hover:bg-red-500/20 hover:text-red-200 transition-colors"
          title="点击重试上传"
          aria-label="重试上传"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
        </button>
      )}

      {/* Delete / Remove Button */}
      <button
        type="button"
        data-testid={`delete-attachment-${attachment.id}`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onDelete(attachment.id);
        }}
        className="ml-0.5 rounded p-0.5 text-text-tertiary hover:bg-bg-surface-active hover:text-text-primary transition-colors"
        title="移除附件"
        aria-label="移除附件"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Uploading progress bar */}
      {isUploading && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden rounded-b-md bg-bg-surface-hover">
          <div
            className="h-full bg-accent transition-all duration-200"
            style={{ width: `${attachment.progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
