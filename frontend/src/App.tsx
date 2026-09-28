import React, { useEffect, useRef, useState } from 'react';
import type { Session } from '@agy-studio/contracts';
import { RouterProvider, useRouter } from './router';
import { AccountsView, ManagerView, PlaygroundView, SettingsView } from './views';
import { useWorkspaceStore } from './stores/workspace.store';
import {
  InboxList,
  ImportSessionsButton,
  NewSessionButton,
  WorkspaceSwitcher,
} from './components/inbox';

export type CurrentSession = Session | null;

const STORAGE_KEY_RIGHT_PANEL_WIDTH = 'agy_studio_right_panel_width';
const STORAGE_KEY_RIGHT_PANEL_COLLAPSED = 'agy_studio_right_panel_collapsed';
const DEFAULT_RIGHT_WIDTH = 380;
const MIN_RIGHT_WIDTH = 260;
const MAX_RIGHT_WIDTH = 640;

function TopBar() {
  const { path, navigate } = useRouter();
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);

  return (
    <header className="flex h-12 w-full shrink-0 items-center justify-between border-b border-border-default bg-bg-panel px-4 text-xs select-none">
      {/* 左侧：工作区选择与导航 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 font-medium text-text-primary">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-accent text-[11px] font-bold text-white shadow-sm">
            A
          </span>
          <span className="tracking-wide">AGY Studio</span>
        </div>
        <div className="h-3.5 w-px bg-border-subtle" />
        <div
          className="flex items-center gap-1.5 rounded border border-border-default bg-bg-surface px-2.5 py-1 text-text-secondary hover:border-border-strong hover:text-text-primary transition-colors"
          data-testid="workspace-select"
        >
          <span className="text-text-tertiary">工作区:</span>
          <span className="font-medium text-text-primary">
            {currentWorkspace?.name ?? '默认工作区'}
          </span>
          {currentWorkspace?.isGitRepo && (
            <span className="rounded bg-accent/15 px-1 py-0.2 font-mono text-[9px] text-accent">
              git
            </span>
          )}
          <span className="text-[10px] text-text-tertiary">▾</span>
        </div>
      </div>

      {/* 中部：路由导航与模型占位 */}
      <div className="flex items-center gap-2">
        <nav className="flex items-center rounded-lg border border-border-default bg-bg-app p-0.5">
          <button
            type="button"
            onClick={() => navigate('/')}
            className={`rounded px-2.5 py-1 transition-colors ${
              path === '/'
                ? 'bg-bg-surface-active font-medium text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            会话
          </button>
          <button
            type="button"
            onClick={() => navigate('/accounts')}
            className={`rounded px-2.5 py-1 transition-colors ${
              path === '/accounts'
                ? 'bg-bg-surface-active font-medium text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            账号
          </button>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className={`rounded px-2.5 py-1 transition-colors ${
              path === '/settings'
                ? 'bg-bg-surface-active font-medium text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            设置
          </button>
          {import.meta.env.DEV && (
            <button
              type="button"
              onClick={() => navigate('/playground')}
              className={`rounded px-2 py-1 text-[11px] font-mono transition-colors ${
                path === '/playground'
                  ? 'bg-accent/20 text-accent font-semibold'
                  : 'text-text-tertiary hover:text-accent'
              }`}
            >
              Playground
            </button>
          )}
        </nav>

        <div className="h-3.5 w-px bg-border-subtle mx-1" />

        <div
          className="flex items-center gap-1.5 rounded border border-border-default bg-bg-surface px-2.5 py-1 text-text-secondary"
          data-testid="model-selector"
        >
          <span className="text-text-tertiary">模型:</span>
          <span className="font-mono text-text-primary">claude-3-7-sonnet</span>
          <span className="text-[10px] text-text-tertiary">▾</span>
        </div>
      </div>

      {/* 右侧：额度环、账号、连接状态 */}
      <div className="flex items-center gap-3">
        {/* 额度 */}
        <div
          className="flex items-center gap-1.5 rounded border border-border-default bg-bg-surface px-2 py-1 text-text-secondary"
          data-testid="quota-badge"
        >
          <div className="relative flex h-3.5 w-3.5 items-center justify-center">
            <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 36 36">
              <path
                className="text-border-default stroke-current"
                strokeWidth="4"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="text-status-success stroke-current"
                strokeDasharray="78, 100"
                strokeWidth="4"
                strokeLinecap="round"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
          </div>
          <span className="font-mono text-[11px] text-text-primary">78%</span>
        </div>

        {/* 账号 */}
        <div
          className="flex items-center gap-1.5 rounded border border-border-default bg-bg-surface px-2.5 py-1 text-text-secondary"
          data-testid="account-dropdown"
        >
          <span className="h-2 w-2 rounded-full bg-status-success" />
          <span className="font-mono text-text-primary">default</span>
          <span className="text-[10px] text-text-tertiary">▾</span>
        </div>

        {/* 连接状态 */}
        <div
          className="flex items-center gap-1.5 rounded-full border border-status-success-subtle bg-status-success-subtle/30 px-2 py-0.5 text-[11px] text-status-success"
          data-testid="connection-status"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-success" />
          <span>已连接</span>
        </div>
      </div>
    </header>
  );
}

function MainLayout() {
  const { path } = useRouter();

  // 右栏宽度与折叠状态，持久化在 localStorage
  const [rightWidth, setRightWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_RIGHT_WIDTH;
    const saved = localStorage.getItem(STORAGE_KEY_RIGHT_PANEL_WIDTH);
    const parsed = saved ? Number.parseInt(saved, 10) : DEFAULT_RIGHT_WIDTH;
    return Number.isFinite(parsed) && parsed >= MIN_RIGHT_WIDTH && parsed <= MAX_RIGHT_WIDTH
      ? parsed
      : DEFAULT_RIGHT_WIDTH;
  });

  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY_RIGHT_PANEL_COLLAPSED) === 'true';
  });

  const isDraggingRef = useRef<boolean>(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_RIGHT_PANEL_WIDTH, rightWidth.toString());
    } catch {}
  }, [rightWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_RIGHT_PANEL_COLLAPSED, isRightCollapsed.toString());
    } catch {}
  }, [isRightCollapsed]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const newWidth = window.innerWidth - moveEvent.clientX;
      if (newWidth >= MIN_RIGHT_WIDTH && newWidth <= MAX_RIGHT_WIDTH) {
        setRightWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const toggleRightPanel = () => {
    setIsRightCollapsed((prev) => !prev);
  };

  const renderView = () => {
    switch (path) {
      case '/accounts':
        return <AccountsView />;
      case '/settings':
        return <SettingsView />;
      case '/playground':
        return <PlaygroundView />;
      case '/':
      default:
        return <ManagerView />;
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg-app text-text-primary">
      <TopBar />

      <main className="flex flex-1 overflow-hidden">
        {/* 左栏：260px 工作区选择与收件箱 / 会话列表 */}
        <aside
          className="flex h-full w-[260px] shrink-0 flex-col border-r border-border-default bg-bg-panel"
          data-testid="left-sidebar"
        >
          {/* 工作区切换 */}
          <div className="border-b border-border-default p-2">
            <WorkspaceSwitcher />
          </div>

          {/* 快捷操作：新建会话与导入会话 */}
          <div className="flex flex-col gap-1.5 border-b border-border-default p-2">
            <NewSessionButton className="w-full" />
            <ImportSessionsButton />
          </div>

          {/* 收件箱标题 */}
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-border-default px-3 text-xs font-medium text-text-secondary">
            <span>收件箱</span>
          </div>

          {/* 会话列表 */}
          <InboxList />
        </aside>

        {/* 中栏：自适应主视窗 */}
        <section
          className="flex h-full flex-1 flex-col overflow-hidden bg-bg-app"
          data-testid="center-panel"
        >
          {renderView()}
        </section>

        {/* 右栏：380px 可拖拽、可折叠 Artifacts 面板 */}
        {!isRightCollapsed && (
          <>
            {/* 拖拽 Handle */}
            <div
              className="w-1 cursor-col-resize bg-border-default hover:bg-accent transition-colors select-none"
              onMouseDown={handleMouseDown}
              data-testid="resizer-handle"
              title="拖拽调节宽度"
            />

            <aside
              style={{ width: `${rightWidth}px` }}
              className="flex h-full shrink-0 flex-col border-l border-border-default bg-bg-panel transition-all duration-75"
              data-testid="right-panel"
            >
              <div className="flex h-10 items-center justify-between border-b border-border-default px-3 text-xs font-medium text-text-secondary">
                <div className="flex items-center gap-2">
                  <span className="text-text-primary">Artifacts</span>
                  <span className="rounded bg-bg-surface px-1.5 py-0.5 text-[10px] font-mono text-text-tertiary">
                    Task / Plan / Media
                  </span>
                </div>
                <button
                  type="button"
                  onClick={toggleRightPanel}
                  className="rounded p-1 text-text-tertiary hover:bg-bg-surface hover:text-text-primary transition-colors"
                  title="折叠面板"
                  data-testid="collapse-right-btn"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 text-xs text-text-tertiary">
                <div className="rounded-lg border border-dashed border-border-default p-4 text-center">
                  <p className="text-text-secondary">Artifacts 占位面板</p>
                  <p className="mt-1 text-[11px]">任务清单、实施计划、完成总结及截图产物</p>
                </div>
              </div>
            </aside>
          </>
        )}

        {/* 折叠状态展开按钮 */}
        {isRightCollapsed && (
          <button
            type="button"
            onClick={toggleRightPanel}
            className="flex w-6 items-center justify-center border-l border-border-default bg-bg-panel text-text-tertiary hover:bg-bg-surface hover:text-text-primary transition-colors"
            title="展开 Artifacts 面板"
            data-testid="expand-right-btn"
          >
            ‹
          </button>
        )}
      </main>
    </div>
  );
}

export function App() {
  return (
    <RouterProvider>
      <MainLayout />
    </RouterProvider>
  );
}

export default App;
