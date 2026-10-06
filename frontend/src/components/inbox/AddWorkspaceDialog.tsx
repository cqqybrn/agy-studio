import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { DirectoryListing, Workspace } from '@agy-studio/contracts';
import { listDirectories } from '../../api/endpoints';
import { useWorkspaceStore } from '../../stores/workspace.store';

export interface AddWorkspaceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (workspace: Workspace) => void;
}

/** Where the folder picker opens next time (per browser). */
const LAST_DIR_KEY = 'agy-studio-last-browse-dir';

function readLastDir(): string | null {
  try {
    return window.localStorage.getItem(LAST_DIR_KEY);
  } catch {
    return null;
  }
}

function storeLastDir(dir: string | null): void {
  try {
    if (dir) window.localStorage.setItem(LAST_DIR_KEY, dir);
  } catch {
    // storage unavailable: start from the drive list next time
  }
}

/** Last path component, for the default workspace name ("D:\\work\\demo" -> "demo"). */
export function folderName(dirPath: string): string {
  const parts = dirPath.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? dirPath;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

function FolderIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M10 4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h6z" />
    </svg>
  );
}

export function AddWorkspaceDialog({ isOpen, onClose, onSuccess }: AddWorkspaceDialogProps) {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** The user typed a path while the initial listing was loading: keep what they typed. */
  const typedRef = useRef(false);

  /** Opens a folder in the picker; returns false (and shows the error) when it cannot be listed. */
  const browse = useCallback(
    async (dir: string | null, initial = false): Promise<boolean> => {
      setBrowsing(true);
      setError(null);
      try {
        const next = await listDirectories(dir ?? undefined);
        setListing(next);
        if (initial && typedRef.current) return true;
        setPath(next.path ?? '');
        if (!nameEdited) setName(next.path ? folderName(next.path) : '');
        storeLastDir(next.path);
        return true;
      } catch (err) {
        setError(errorMessage(err));
        return false;
      } finally {
        setBrowsing(false);
      }
    },
    [nameEdited],
  );

  // Open where the user last browsed (or at the drive list).
  useEffect(() => {
    if (!isOpen) return;
    setNameEdited(false);
    typedRef.current = false;
    const last = readLastDir();
    void (async () => {
      // The remembered folder may have been moved or deleted: fall back to the drive list.
      if (!last || !(await browse(last, true))) await browse(null, true);
    })();
    // Only on open; later navigation goes through browse() directly.
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedPath = path.trim();
    if (!trimmedPath) {
      setError('请选择或输入一个文件夹');
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
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const atTop = listing !== null && listing.path === null;

  return (
    <div
      data-testid="add-workspace-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-border-default bg-bg-panel p-5 shadow-xl text-xs select-none"
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

        <form onSubmit={handleSubmit} className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
          <div>
            <label className="block font-medium text-text-secondary">
              工作区文件夹 <span className="text-status-error">*</span>
            </label>
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="button"
                data-testid="folder-up-btn"
                onClick={() => void browse(listing?.parent ?? null)}
                disabled={browsing || atTop}
                title={listing?.parent ? '上一级' : '回到磁盘列表'}
                className="shrink-0 rounded border border-border-default bg-bg-surface px-2.5 text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary disabled:opacity-40"
              >
                ↑
              </button>
              <input
                type="text"
                data-testid="workspace-path-input"
                value={path}
                onChange={(e) => {
                  typedRef.current = true;
                  setPath(e.target.value);
                  if (!nameEdited) setName(e.target.value.trim() ? folderName(e.target.value.trim()) : '');
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  // Enter in the path box opens that folder instead of submitting
                  if (e.key === 'Enter' && path.trim()) {
                    e.preventDefault();
                    void browse(path.trim());
                  }
                }}
                placeholder="在下方点选文件夹，或直接粘贴路径后回车"
                disabled={loading}
                className="min-w-0 flex-1 rounded border border-border-default bg-bg-surface px-3 py-2 font-mono text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          <div
            data-testid="folder-list"
            className="min-h-[12rem] flex-1 overflow-y-auto rounded border border-border-default bg-bg-surface/50 p-1"
          >
            {browsing && listing === null ? (
              <div className="p-3 text-text-tertiary">加载中…</div>
            ) : listing && listing.entries.length === 0 ? (
              <div className="p-3 text-text-tertiary">这个文件夹里没有子文件夹，可以直接添加它</div>
            ) : (
              listing?.entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  data-testid="folder-entry"
                  onClick={() => void browse(entry.path)}
                  disabled={browsing}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary"
                  title={entry.path}
                >
                  <FolderIcon />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))
            )}
          </div>

          <div>
            <label className="block font-medium text-text-secondary">工作区名称</label>
            <input
              type="text"
              data-testid="workspace-name-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameEdited(true);
              }}
              placeholder="默认使用文件夹名"
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

          <div className="flex items-center justify-end gap-2 border-t border-border-default pt-3">
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
              className="rounded bg-accent px-4 py-1.5 font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {loading ? '添加中...' : '添加这个文件夹'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
