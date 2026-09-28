import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { AgentMode, Effort } from '@agy-studio/contracts';
import { uploadAttachments } from '../../api/endpoints';
import { useSessionStore, type SendMessageOptions } from '../../stores/session.store';
import { useWorkspaceStore } from '../../stores/workspace.store';
import { AttachmentChip } from './AttachmentChip';
import { compressImageIfNeeded, formatFileSize } from './compress';
import { EffortPicker } from './EffortPicker';
import { ModelPicker } from './ModelPicker';
import { ModePicker } from './ModePicker';
import {
  COMPOSER_LIMITS,
  type ComposerAttachment,
  type ComposerProps,
} from './types';

export const COMPOSER_DRAFT_PREFIX = 'agy-composer-draft:';

// In-memory fallback for non-browser / SSR / test environments without window.localStorage
const memoryDraftStorage = new Map<string, string>();

function getLocalStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
    return (globalThis as any).localStorage;
  }
  return null;
}

export function getDraftStorageKey(sessionId?: string): string {
  return `${COMPOSER_DRAFT_PREFIX}${sessionId ?? 'default'}`;
}

export function loadDraft(sessionId?: string): string {
  const key = getDraftStorageKey(sessionId);
  const storage = getLocalStorage();
  if (storage) {
    try {
      return storage.getItem(key) ?? '';
    } catch {
      // ignore
    }
  }
  return memoryDraftStorage.get(key) ?? '';
}

export function saveDraft(text: string, sessionId?: string): void {
  const key = getDraftStorageKey(sessionId);
  const storage = getLocalStorage();
  if (storage) {
    try {
      if (text) {
        storage.setItem(key, text);
      } else {
        storage.removeItem(key);
      }
    } catch {
      // ignore
    }
  }
  if (text) {
    memoryDraftStorage.set(key, text);
  } else {
    memoryDraftStorage.delete(key);
  }
}

export function clearDraft(sessionId?: string): void {
  const key = getDraftStorageKey(sessionId);
  const storage = getLocalStorage();
  if (storage) {
    try {
      storage.removeItem(key);
    } catch {
      // ignore
    }
  }
  memoryDraftStorage.delete(key);
}

export function Composer({
  sessionId: propSessionId,
  workspaceId: propWorkspaceId,
  placeholder = '输入指令，Enter 发送，Shift+Enter 换行…',
  disabled = false,
  model: propModel,
  effort: propEffort,
  mode: propMode,
  onModelChange,
  onEffortChange,
  onModeChange,
  onSend,
  onAbort,
  className = '',
}: ComposerProps) {
  // Store integration
  const storeActiveSessionId = useSessionStore((s) => s.activeSessionId);
  const sessionId = propSessionId ?? storeActiveSessionId ?? undefined;

  const currentWorkspace = useWorkspaceStore((w) => w.currentWorkspace);
  const workspaceId = propWorkspaceId ?? currentWorkspace?.id ?? 'default-workspace';

  const sessionSlot = useSessionStore((s) => (sessionId ? s.slots[sessionId] : undefined));
  const activeRunId = sessionSlot?.activeRunId ?? sessionSlot?.pendingRunId ?? null;
  const isRunning = Boolean(activeRunId);

  const storeSend = useSessionStore((s) => s.send);
  const storeAbort = useSessionStore((s) => s.abort);

  // Local state
  const [text, setText] = useState<string>(() => loadDraft(sessionId));
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(propModel);
  const [selectedEffort, setSelectedEffort] = useState<Effort | undefined>(propEffort);
  const [selectedMode, setSelectedMode] = useState<AgentMode | undefined>(propMode);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const isComposingRef = useRef<boolean>(false);

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const newHeight = Math.min(Math.max(el.scrollHeight, 40), 240);
    el.style.height = `${newHeight}px`;
  }, []);

  // Reload draft if sessionId changes
  useEffect(() => {
    const draft = loadDraft(sessionId);
    setText(draft);
    // Next tick adjust height
    setTimeout(adjustTextareaHeight, 0);
  }, [sessionId, adjustTextareaHeight]);

  // Adjust height on text changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [text, adjustTextareaHeight]);

  // Sync props down to local state if provided
  useEffect(() => {
    if (propModel !== undefined) setSelectedModel(propModel);
  }, [propModel]);
  useEffect(() => {
    if (propEffort !== undefined) setSelectedEffort(propEffort);
  }, [propEffort]);
  useEffect(() => {
    if (propMode !== undefined) setSelectedMode(propMode);
  }, [propMode]);

  // Handle draft saving on text change
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    saveDraft(val, sessionId);
    if (validationError) setValidationError(null);
  };

  // Upload single attachment
  const executeUpload = useCallback(
    async (item: ComposerAttachment) => {
      // Step 1: Image compression
      setAttachments((prev) =>
        prev.map((a) => (a.id === item.id ? { ...a, status: 'compressing', progress: 10, error: null } : a)),
      );

      let fileToUpload = item.file;
      try {
        fileToUpload = await compressImageIfNeeded(item.file);
      } catch {
        // compression failure falls back to original file
      }

      // Step 2: Upload via uploadAttachments
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === item.id
            ? {
                ...a,
                status: 'uploading',
                size: fileToUpload.size,
                progress: 20,
              }
            : a,
        ),
      );

      try {
        const res = await uploadAttachments(
          [fileToUpload],
          workspaceId,
          sessionId,
          (percent) => {
            setAttachments((prev) =>
              prev.map((a) => (a.id === item.id ? { ...a, progress: Math.max(20, percent) } : a)),
            );
          },
        );

        const uploaded = res.attachments?.[0];
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === item.id
              ? {
                  ...a,
                  status: 'uploaded',
                  progress: 100,
                  uploadedAttachment: uploaded,
                }
              : a,
          ),
        );
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : '上传失败';
        setAttachments((prev) =>
          prev.map((a) => (a.id === item.id ? { ...a, status: 'error', error: errorMsg } : a)),
        );
      }
    },
    [workspaceId, sessionId],
  );

  // Validate and enqueue new files
  const addFiles = useCallback(
    (files: FileList | File[]) => {
      setValidationError(null);
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      // 1. Max files per upload limit
      if (attachments.length + fileArray.length > COMPOSER_LIMITS.maxFilesPerUpload) {
        setValidationError(
          `单次最多上传 ${COMPOSER_LIMITS.maxFilesPerUpload} 个文件（当前已有 ${attachments.length} 个）`,
        );
        return;
      }

      // 2. Total size limit calculation
      const currentTotalSize = attachments.reduce((sum, a) => sum + a.size, 0);
      const incomingTotalSize = fileArray.reduce((sum, f) => sum + f.size, 0);
      if (currentTotalSize + incomingTotalSize > COMPOSER_LIMITS.maxTotalSize) {
        setValidationError(
          `附件总大小不能超过 ${formatFileSize(COMPOSER_LIMITS.maxTotalSize)}（当前总计 ${formatFileSize(
            currentTotalSize + incomingTotalSize,
          )}）`,
        );
        return;
      }

      const validNewItems: ComposerAttachment[] = [];

      for (const file of fileArray) {
        // Individual file size check
        if (file.size > COMPOSER_LIMITS.maxFileSize) {
          setValidationError(
            `文件 "${file.name}" 大小 (${formatFileSize(file.size)}) 超过单文件上限 ${formatFileSize(
              COMPOSER_LIMITS.maxFileSize,
            )}`,
          );
          return;
        }

        const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const newItem: ComposerAttachment = {
          id,
          file,
          originalName: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          status: 'pending',
          progress: 0,
        };
        validNewItems.push(newItem);
      }

      setAttachments((prev) => [...prev, ...validNewItems]);

      // Trigger upload for all new items
      for (const item of validNewItems) {
        executeUpload(item);
      }
    },
    [attachments, executeUpload],
  );

  // Remove attachment
  const handleDeleteAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Retry failed upload
  const handleRetryAttachment = useCallback(
    (id: string) => {
      const item = attachments.find((a) => a.id === id);
      if (item) {
        executeUpload(item);
      }
    },
    [attachments, executeUpload],
  );

  // Check upload state
  const isUploadingAny = attachments.some(
    (a) => a.status === 'uploading' || a.status === 'compressing' || a.status === 'pending',
  );
  const hasFailedUploads = attachments.some((a) => a.status === 'error');

  // Submit message
  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (isUploadingAny) return;

    const attachmentIds = attachments
      .map((a) => a.uploadedAttachment?.id)
      .filter((id): id is string => Boolean(id));

    const options: SendMessageOptions = {
      attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      model: selectedModel,
      effort: selectedEffort,
      mode: selectedMode,
    };

    try {
      if (onSend) {
        await onSend(trimmed, options);
      } else if (sessionId) {
        await storeSend(sessionId, trimmed, options);
      }

      // Success: clear input, draft, attachments
      setText('');
      clearDraft(sessionId);
      setAttachments([]);
      setValidationError(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = '40px';
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '发送失败，请重试';
      setValidationError(errorMsg);
    }
  };

  // Abort running task
  const handleAbort = async () => {
    if (!activeRunId) return;
    try {
      if (onAbort) {
        await onAbort(activeRunId);
      } else if (sessionId) {
        await storeAbort(sessionId, activeRunId);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : '中止失败';
      setValidationError(errorMsg);
    }
  };

  // Keydown handler
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Check composing state via e.nativeEvent.isComposing or ref flag
    const isComposing =
      e.nativeEvent.isComposing ||
      isComposingRef.current ||
      ('keyCode' in e && (e as any).keyCode === 229);

    if (e.key === 'Enter') {
      if (isComposing) {
        // IME composition in progress: do NOT send
        return;
      }

      if (e.shiftKey) {
        // Shift+Enter: newline, let default behavior happen
        return;
      }

      // Enter without Shift: trigger send
      e.preventDefault();
      if (!isRunning && !isUploadingAny && !disabled) {
        handleSend();
      }
    }
  };

  // Paste handler (clipboard images / files)
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      addFiles(files);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingOver) setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  // Send button disabled state
  const isSendDisabled =
    disabled ||
    isUploadingAny ||
    (!text.trim() && attachments.length === 0) ||
    hasFailedUploads;

  const uniqueId = useId();

  return (
    <div
      data-testid="composer-container"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex flex-col rounded-xl border transition-all duration-200 ${
        isDraggingOver
          ? 'border-accent bg-accent/5 ring-1 ring-accent'
          : 'border-border-default bg-bg-panel/90 shadow-lg focus-within:border-border-strong'
      } ${className}`}
    >
      {/* Drag & drop overlay hint */}
      {isDraggingOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-bg-app/80 text-sm font-medium text-accent">
          <span>拖拽文件至此处上传</span>
        </div>
      )}

      {/* Attachments preview list */}
      {attachments.length > 0 && (
        <div
          data-testid="attachments-list"
          className="flex flex-wrap gap-2 p-3 pb-0"
        >
          {attachments.map((att) => (
            <AttachmentChip
              key={att.id}
              attachment={att}
              onDelete={handleDeleteAttachment}
              onRetry={handleRetryAttachment}
              disabled={disabled || isRunning}
            />
          ))}
        </div>
      )}

      {/* Validation / error banner */}
      {validationError && (
        <div
          data-testid="composer-validation-error"
          className="mx-3 mt-2 flex items-center justify-between rounded-md bg-red-950/40 border border-red-500/30 px-2.5 py-1 text-xs text-red-300"
        >
          <span>{validationError}</span>
          <button
            type="button"
            onClick={() => setValidationError(null)}
            className="text-red-400 hover:text-red-200"
            aria-label="关闭错误提示"
          >
            ×
          </button>
        </div>
      )}

      {/* Textarea input area */}
      <div className="p-3">
        <textarea
          ref={textareaRef}
          data-testid="composer-textarea"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          className="w-full resize-none bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none leading-relaxed min-h-[40px] max-h-[240px]"
        />
      </div>

      {/* Bottom toolbar & action buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-3 py-2">
        {/* Left: Pickers and Attachment triggers */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* File Picker Button */}
          <button
            type="button"
            data-testid="attach-file-button"
            disabled={disabled || isRunning || attachments.length >= COMPOSER_LIMITS.maxFilesPerUpload}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-md border border-transparent p-1.5 text-xs text-text-secondary hover:border-border-default hover:bg-bg-surface hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="添加附件或图片"
            aria-label="添加附件"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l7.88-7.88" />
            </svg>
          </button>

          {/* Camera Button (Mobile Photo Capture) */}
          <button
            type="button"
            data-testid="attach-camera-button"
            disabled={disabled || isRunning || attachments.length >= COMPOSER_LIMITS.maxFilesPerUpload}
            onClick={() => cameraInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-md border border-transparent p-1.5 text-xs text-text-secondary hover:border-border-default hover:bg-bg-surface hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="拍照上传"
            aria-label="拍照上传"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            id={`file-input-${uniqueId}`}
            type="file"
            multiple
            className="hidden"
            data-testid="hidden-file-input"
            onChange={(e) => {
              if (e.target.files) {
                addFiles(e.target.files);
                e.target.value = ''; // Reset input to allow re-selecting same file
              }
            }}
          />

          {/* Hidden camera capture input */}
          <input
            ref={cameraInputRef}
            id={`camera-input-${uniqueId}`}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            data-testid="hidden-camera-input"
            onChange={(e) => {
              if (e.target.files) {
                addFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />

          <div className="h-4 w-px bg-border-default mx-1 hidden sm:block" />

          {/* Sub Pickers */}
          <ModelPicker
            value={selectedModel}
            disabled={disabled || isRunning}
            onChange={(m) => {
              setSelectedModel(m);
              onModelChange?.(m);
            }}
          />

          <EffortPicker
            value={selectedEffort}
            disabled={disabled || isRunning}
            onChange={(ef) => {
              setSelectedEffort(ef);
              onEffortChange?.(ef);
            }}
          />

          <ModePicker
            value={selectedMode}
            disabled={disabled || isRunning}
            onChange={(md) => {
              setSelectedMode(md);
              onModeChange?.(md);
            }}
          />
        </div>

        {/* Right: Send or Stop Button */}
        <div className="flex items-center gap-2 ml-auto">
          {isRunning ? (
            <button
              type="button"
              data-testid="composer-stop-button"
              onClick={handleAbort}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-red-500 active:scale-95 transition-all"
              title="中止当前运行"
            >
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              <span>停止</span>
            </button>
          ) : (
            <button
              type="button"
              data-testid="composer-send-button"
              disabled={isSendDisabled}
              onClick={handleSend}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-accent-hover active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-accent transition-all"
              title={isUploadingAny ? '附件上传中…' : '发送 (Enter)'}
            >
              <span>发送</span>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
