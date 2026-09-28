import React, { useState } from 'react';
import type { Workspace } from '@agy-studio/contracts';
import { useWorkspaceStore } from '../../stores/workspace.store';

export interface AddWorkspaceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (workspace: Workspace) => void;
}

export function AddWorkspaceDialog({
  isOpen,
  onClose,
  onSuccess,
}: AddWorkspaceDialogProps) {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedPath = path.trim();
    if (!trimmedPath) {
      setError('请输入工作区绝对路径');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const created = await useWorkspaceStore.getState().createWorkspace({
        path: trimmedPath,
        name: name.trim() || undefined,
      });
      setPath('');
      setName('');
      onSuccess?.(created);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError(null);
    onClose();
  };

  return (
    <div
      data-testid="add-workspace-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div
        className="w-full max-w-md rounded-lg border border-border-default bg-bg-panel p-5 shadow-xl text-xs select-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-default pb-3">
          <h3 className="text-sm font-semibold text-text-primary">添加工作区</h3>
          <button
            type="button"
            data-testid="dialog-close-x-btn"
            onClick={handleClose}
            className="rounded p-1 text-text-tertiary hover:bg-bg-surface hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block font-medium text-text-secondary">
              工作区绝对路径 <span className="text-status-error">*</span>
            </label>
            <input
              type="text"
              data-testid="workspace-path-input"
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                if (error) setError(null);
              }}
              placeholder="例如: G:\my-project 或 /home/user/project"
              disabled={loading}
              className="mt-1.5 w-full rounded border border-border-default bg-bg-surface px-3 py-2 font-mono text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-medium text-text-secondary">
              工作区名称（可选）
            </label>
            <input
              type="text"
              data-testid="workspace-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="留空则自动从路径获取文件夹名"
              disabled={loading}
              className="mt-1.5 w-full rounded border border-border-default bg-bg-surface px-3 py-2 text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none"
            />
          </div>

          {error && (
            <div
              data-testid="workspace-error"
              className="rounded border border-status-error/30 bg-status-error/10 p-2.5 text-status-error"
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-default">
            <button
              type="button"
              data-testid="dialog-cancel-btn"
              onClick={handleClose}
              disabled={loading}
              className="rounded border border-border-default bg-bg-surface px-3 py-1.5 text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              data-testid="create-workspace-submit"
              disabled={loading || !path.trim()}
              className="rounded bg-accent px-4 py-1.5 font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {loading ? '添加中...' : '添加'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
