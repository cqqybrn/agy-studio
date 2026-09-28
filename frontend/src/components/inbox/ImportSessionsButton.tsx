import React, { useState } from 'react';
import type { Session } from '@agy-studio/contracts';
import { useSessionStore } from '../../stores/session.store';
import { useWorkspaceStore } from '../../stores/workspace.store';

export interface ImportSessionsButtonProps {
  className?: string;
  onImported?: (sessions: Session[]) => void;
}

export function ImportSessionsButton({
  className = '',
  onImported,
}: ImportSessionsButtonProps) {
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const [isImporting, setIsImporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleImport = async () => {
    const wsId = currentWorkspace?.id || workspaces[0]?.id;
    if (!wsId) {
      setErrorMessage('请先选择工作区');
      return;
    }

    setIsImporting(true);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const imported = await useSessionStore.getState().importSessions({
        workspaceId: wsId,
      });
      setStatusMessage(`成功导入 ${imported.length} 个会话`);
      onImported?.(imported);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`导入失败: ${msg}`);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className={`relative flex flex-col items-stretch text-xs ${className}`}>
      <button
        type="button"
        data-testid="import-sessions-btn"
        onClick={handleImport}
        disabled={isImporting}
        className="flex items-center justify-center gap-1.5 rounded border border-border-default bg-bg-surface px-2.5 py-1.5 font-medium text-text-secondary hover:border-border-strong hover:bg-bg-surface-hover hover:text-text-primary disabled:opacity-50 transition-colors"
        title="扫描磁盘导入此工作区中现存的 agy 会话"
      >
        <svg
          className="h-3.5 w-3.5 text-text-tertiary"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
          />
        </svg>
        <span>{isImporting ? '导入中...' : '导入会话'}</span>
      </button>

      {/* 提示信息 */}
      {statusMessage && (
        <div
          data-testid="import-status"
          className="mt-1 flex items-center justify-between rounded bg-status-success/15 px-2 py-1 text-[11px] text-status-success animate-fade-in"
        >
          <span>{statusMessage}</span>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="ml-1 text-text-tertiary hover:text-text-primary"
          >
            ✕
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          data-testid="import-error"
          className="mt-1 flex items-center justify-between rounded bg-status-error/15 px-2 py-1 text-[11px] text-status-error animate-fade-in"
        >
          <span className="truncate" title={errorMessage}>
            {errorMessage}
          </span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="ml-1 text-text-tertiary hover:text-text-primary"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
