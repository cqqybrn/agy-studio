import React, { useEffect, useRef, useState } from 'react';
import type { Workspace } from '@agy-studio/contracts';
import { useSessionStore } from '../../stores/session.store';
import { useWorkspaceStore } from '../../stores/workspace.store';
import { AddWorkspaceDialog } from './AddWorkspaceDialog';

export interface WorkspaceSwitcherProps {
  className?: string;
  onWorkspaceChange?: (workspace: Workspace) => void;
}

export function WorkspaceSwitcher({
  className = '',
  onWorkspaceChange,
}: WorkspaceSwitcherProps) {
  const storeWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const storeCurrentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);
  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace);

  const workspaces = storeWorkspaces.length > 0 ? storeWorkspaces : useWorkspaceStore.getState().workspaces;
  const currentWorkspace = storeCurrentWorkspace ?? useWorkspaceStore.getState().currentWorkspace;

  const [isOpen, setIsOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayName = currentWorkspace?.name || '默认工作区';

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isOpen]);

  const handleSelectWorkspace = (ws: Workspace) => {
    selectWorkspace(ws.id);
    void useSessionStore.getState().fetchSessions({ workspaceId: ws.id });
    onWorkspaceChange?.(ws);
    setIsOpen(false);
  };

  const handleOpenAddDialog = () => {
    setIsOpen(false);
    setIsAddDialogOpen(true);
  };

  return (
    <div ref={containerRef} className={`relative select-none text-xs ${className}`}>
      {/* 触发下拉按钮 */}
      <button
        type="button"
        data-testid="workspace-switcher-btn"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border-default bg-bg-surface px-2.5 py-1.5 text-text-secondary hover:border-border-strong hover:text-text-primary transition-colors"
      >
        <div className="flex min-w-0 items-center gap-1.5 truncate">
          <span className="shrink-0 text-text-tertiary">📁</span>
          <span className="truncate font-medium text-text-primary" title={displayName}>
            {displayName}
          </span>
          {currentWorkspace?.isGitRepo && (
            <span className="rounded bg-accent/15 px-1 py-0.2 font-mono text-[9px] text-accent">
              git
            </span>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-text-tertiary">
          {isOpen ? '▴' : '▾'}
        </span>
      </button>

      {/* 下拉面板 */}
      {isOpen && (
        <div
          data-testid="workspace-dropdown-menu"
          className="absolute left-0 top-full z-40 mt-1 max-h-60 w-full min-w-[220px] overflow-y-auto rounded-md border border-border-default bg-bg-panel p-1 shadow-xl"
        >
          <div className="px-2 py-1 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">
            工作区列表
          </div>

          <div className="space-y-0.5">
            {workspaces.length === 0 ? (
              <div className="px-2 py-1.5 text-[11px] text-text-tertiary">
                暂无工作区
              </div>
            ) : (
              workspaces.map((ws) => {
                const isSelected = ws.id === currentWorkspace?.id;
                return (
                  <button
                    key={ws.id}
                    type="button"
                    data-testid={`workspace-item-${ws.id}`}
                    onClick={() => handleSelectWorkspace(ws)}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
                      isSelected
                        ? 'bg-bg-surface-active font-medium text-text-primary'
                        : 'text-text-secondary hover:bg-bg-surface hover:text-text-primary'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 truncate font-medium">
                        <span className="truncate">{ws.name}</span>
                        {ws.isGitRepo && (
                          <span className="rounded bg-accent/10 px-1 py-0.2 text-[9px] font-mono text-accent">
                            git
                          </span>
                        )}
                      </div>
                      <div className="truncate font-mono text-[10px] text-text-tertiary">
                        {ws.path}
                      </div>
                    </div>
                    {isSelected && (
                      <span className="shrink-0 pl-1.5 text-accent text-xs">✓</span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div className="mt-1 border-t border-border-default pt-1">
            <button
              type="button"
              data-testid="add-workspace-btn"
              onClick={handleOpenAddDialog}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left font-medium text-accent hover:bg-accent/10 transition-colors"
            >
              <span>+</span>
              <span>添加工作区</span>
            </button>
          </div>
        </div>
      )}

      {/* 添加工作区弹窗 */}
      <AddWorkspaceDialog
        isOpen={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        onSuccess={(ws) => {
          handleSelectWorkspace(ws);
        }}
      />
    </div>
  );
}
