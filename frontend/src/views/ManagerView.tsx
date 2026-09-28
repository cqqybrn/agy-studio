import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Attachment, Capabilities, Session } from '@agy-studio/contracts';
import type {
  AssistantMessageItem,
  ErrorItem,
  RunDividerItem,
  StalledNoticeItem,
  SubagentItem,
  ThinkingItem,
  TimelineItem,
  ToolGroupItem,
  ToolItem,
  UserMessageItem,
} from '../domain/timeline.types';
import { Composer } from '../components/composer';
import {
  ErrorNotice,
  MessageMarkdown,
  RunDivider,
  StalledNotice,
  StatusDot,
  SubagentCardContainer,
  ThinkingBlock,
  ToolCard,
  ToolGroupCard,
} from '../components/timeline';
import { useConnectionStore } from '../stores/connection.store';
import { useSessionStore } from '../stores/session.store';
import { useUiStore } from '../stores/ui.store';
import { useWorkspaceStore } from '../stores/workspace.store';
import { getCapabilities, updateSession as apiUpdateSession } from '../api/endpoints';
import type { WsStatus } from '../api/ws';

export interface ManagerViewProps {
  /** 可选显式指定的 sessionId，未传时使用 sessionStore.activeSessionId */
  sessionId?: string;
  /** 可选注入的条目列表（用于测试或 Playground 覆盖） */
  initialItems?: TimelineItem[];
  /** 可选自定义类名 */
  className?: string;
  /** 可选显式注入的 capabilities（用于测试或 Playground 覆盖） */
  mockCapabilities?: Capabilities | null;
  /** 可选显式注入的连接状态（用于测试覆盖） */
  connectionStatus?: WsStatus;
}

// ============================================================================
// 单项时间线条目分发器 (TimelineItemDispatcher)
// 严格按规范将 9 类条目映射到对应组件
// ============================================================================

export interface TimelineItemDispatcherProps {
  item: TimelineItem;
  sessionId?: string;
  thinkingHidden?: boolean;
}

export function TimelineItemDispatcher({
  item,
  sessionId,
  thinkingHidden = false,
}: TimelineItemDispatcherProps) {
  switch (item.kind) {
    case 'user_message': {
      const userItem = item as UserMessageItem;
      return (
        <div className="py-2.5" data-testid={`timeline-item-user-${userItem.id}`}>
          <div className="flex items-start gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent font-semibold text-xs select-none">
              U
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-primary">User</span>
                {userItem.createdAt && (
                  <span className="text-[11px] text-text-tertiary font-mono">
                    {new Date(userItem.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                )}
              </div>

              {/* 附件展示 */}
              {userItem.attachments && userItem.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {userItem.attachments.map((att) => (
                    <div
                      key={att.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-bg-surface px-2.5 py-1 text-xs text-text-secondary"
                      title={att.originalName}
                    >
                      <span className="text-text-tertiary">📎</span>
                      <span className="max-w-[200px] truncate">{att.originalName}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 用户文本 */}
              <div className="rounded-lg border border-border-default/60 bg-bg-surface px-3.5 py-2.5 text-xs text-text-primary leading-relaxed shadow-sm">
                <MessageMarkdown content={userItem.text} />
              </div>
            </div>
          </div>
        </div>
      );
    }

    case 'assistant_message': {
      const asstItem = item as AssistantMessageItem;
      return (
        <div className="py-2.5" data-testid={`timeline-item-assistant-${asstItem.id}`}>
          <div className="flex items-start gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-white font-semibold text-xs shadow-sm select-none">
              A
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text-primary">Assistant</span>
                {!asstItem.isComplete && (
                  <span className="flex items-center gap-1 text-[11px] text-accent">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                    <span>生成中…</span>
                  </span>
                )}
              </div>
              <div className="rounded-lg border border-border-default bg-bg-surface/60 px-4 py-3 text-xs leading-relaxed text-text-primary">
                <MessageMarkdown content={asstItem.text} streaming={!asstItem.isComplete} />
              </div>
            </div>
          </div>
        </div>
      );
    }

    case 'thinking':
      return (
        <div data-testid={`timeline-item-thinking-${item.id}`}>
          <ThinkingBlock item={item as ThinkingItem} hidden={thinkingHidden} />
        </div>
      );

    case 'tool':
      return (
        <div data-testid={`timeline-item-tool-${item.id}`}>
          <ToolCard item={item as ToolItem} />
        </div>
      );

    case 'tool_group':
      return (
        <div data-testid={`timeline-item-tool-group-${item.id}`}>
          <ToolGroupCard item={item as ToolGroupItem} />
        </div>
      );

    case 'subagent':
      return (
        <div data-testid={`timeline-item-subagent-${item.id}`}>
          <SubagentCardContainer
            item={item as SubagentItem}
            sessionId={sessionId}
          />
        </div>
      );

    case 'run_divider':
      return (
        <div data-testid={`timeline-item-run-divider-${item.id}`}>
          <RunDivider item={item as RunDividerItem} />
        </div>
      );

    case 'error':
      return (
        <div data-testid={`timeline-item-error-${item.id}`}>
          <ErrorNotice item={item as ErrorItem} />
        </div>
      );

    case 'stalled_notice':
      return (
        <div data-testid={`timeline-item-stalled-${item.id}`}>
          <StalledNotice item={item as StalledNoticeItem} />
        </div>
      );

    default:
      return null;
  }
}

// ============================================================================
// 主组件 ManagerView
// ============================================================================

export function ManagerView({
  sessionId: explicitSessionId,
  initialItems,
  className = '',
  mockCapabilities,
  connectionStatus: propConnectionStatus,
}: ManagerViewProps) {
  // Store 状态订阅（在 SSR / Node 测试环境下 fallback 到 getState() 获取最新状态）
  const isServer = typeof window === 'undefined';
  const sessionStore = isServer ? useSessionStore.getState() : useSessionStore();
  const connStore = isServer ? useConnectionStore.getState() : useConnectionStore();
  const workspaceStore = isServer ? useWorkspaceStore.getState() : useWorkspaceStore();
  const uiStore = isServer ? useUiStore.getState() : useUiStore();

  const activeSessionId = explicitSessionId ?? sessionStore.activeSessionId;
  const slots = sessionStore.slots;
  const sessionList = sessionStore.list;
  const createSession = sessionStore.createSession;
  const currentWorkspace = workspaceStore.currentWorkspace;
  const connectionStatus = propConnectionStatus ?? connStore.status;
  const showThinkingOverride = uiStore.showThinkingOverride;

  // 会话插槽与时间线条目
  const slot = activeSessionId ? slots[activeSessionId] : undefined;
  const items = useMemo(() => {
    if (initialItems) return initialItems;
    return slot?.timeline.items ?? [];
  }, [initialItems, slot?.timeline.items]);

  const currentSession = useMemo(() => {
    return sessionList.find((s) => s.id === activeSessionId) ?? null;
  }, [sessionList, activeSessionId]);

  // Capabilities 状态
  const [capabilities, setCapabilities] = useState<Capabilities | null>(
    mockCapabilities ?? null,
  );

  useEffect(() => {
    if (mockCapabilities !== undefined) {
      setCapabilities(mockCapabilities);
      return;
    }
    let mounted = true;
    getCapabilities()
      .then((cap) => {
        if (mounted) setCapabilities(cap);
      })
      .catch(() => {
        // 后端可能未启动或探测失败，静默处理
      });
    return () => {
      mounted = false;
    };
  }, [mockCapabilities]);

  // 是否检测到 agy 版本升级（profileAgyVersion 与 agyVersion 不一致）
  const isAgyUpgradeDetected = useMemo(() => {
    const caps = mockCapabilities !== undefined ? mockCapabilities : capabilities;
    if (!caps) return false;
    if (
      caps.agyVersion &&
      caps.profileAgyVersion &&
      caps.agyVersion !== caps.profileAgyVersion
    ) {
      return true;
    }
    // 兼容可能配置在 features 或 mock 上的标记
    if ((caps as any).versionMismatch === true) return true;
    if ((caps.features as any)?.versionMismatch === true) return true;
    return false;
  }, [capabilities, mockCapabilities]);

  // 会话标题重命名状态
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleText, setEditingTitleText] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const isCancellingTitleRef = useRef(false);

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const handleStartRename = () => {
    setEditingTitleText(currentSession?.title || '新会话');
    setIsEditingTitle(true);
  };

  const handleSaveTitle = async () => {
    if (!isEditingTitle) return;
    // ★ B-9：检查是否取消
    if (isCancellingTitleRef.current) {
      isCancellingTitleRef.current = false;
      setIsEditingTitle(false);
      return;
    }
    setIsEditingTitle(false);
    const trimmed = editingTitleText.trim();
    if (!trimmed || !activeSessionId || trimmed === currentSession?.title) return;

    try {
      const store = useSessionStore.getState();
      if (typeof store.renameSession === 'function') {
        await store.renameSession(activeSessionId, trimmed);
      } else {
        const updated = await apiUpdateSession(activeSessionId, { title: trimmed });
        store.handleSessionUpserted(updated);
      }
    } catch {
      // 重命名失败时恢复原样
    }
  };

  const handleCancelTitle = () => {
    isCancellingTitleRef.current = true;
    // blur 会触发 handleSaveTitle，通过 ref 标记跳过保存
  };

  // 虚拟滚动容器与自动跟随
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAutoFollowRef = useRef<boolean>(true);
  const [isAtBottom, setIsAtBottom] = useState<boolean>(true);
  const [newMessageCount, setNewMessageCount] = useState<number>(0);
  const prevItemsLengthRef = useRef<number>(items.length);

  // TanStack Virtual 虚拟滚动实例
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 80,
    overscan: 5,
    initialRect: { width: 800, height: 600 },
  });

  // 检查是否靠近底部 (< 80px)
  const checkIsAtBottom = useCallback((el: HTMLElement) => {
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom < 80;
  }, []);

  // 监听用户滚动
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = checkIsAtBottom(el);
    setIsAtBottom(atBottom);
    isAutoFollowRef.current = atBottom;
    if (atBottom) {
      setNewMessageCount(0);
    }
  }, [checkIsAtBottom]);

  // 回到底部动作
  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
    isAutoFollowRef.current = true;
    setIsAtBottom(true);
    setNewMessageCount(0);
  }, []);

  // 切换会话时，直接瞬时定位到时间线最底部并恢复自动跟随
  useEffect(() => {
    isAutoFollowRef.current = true;
    setIsAtBottom(true);
    setNewMessageCount(0);
    prevItemsLengthRef.current = items.length;

    const el = scrollContainerRef.current;
    if (el) {
      // 双帧缓冲确保 DOM 挂载和高度测量完毕
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
        if (items.length > 0) {
          rowVirtualizer.scrollToIndex(items.length - 1, { align: 'end' });
        }
      });
    }
  }, [activeSessionId]);

  // 新消息 / 内容增长时自动跟随或累加未读数
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || items.length === 0) return;

    const prevLength = prevItemsLengthRef.current;
    const isNewItemAdded = items.length > prevLength;

    if (isAutoFollowRef.current) {
      requestAnimationFrame(() => {
        // ★ B-8：新消息用 smooth，同一条消息的流式增长用 auto 避免动画打断
        el.scrollTo({
          top: el.scrollHeight,
          behavior: isNewItemAdded ? 'smooth' : 'auto',
        });
      });
    } else if (isNewItemAdded) {
      // 用户上滑中：累加新消息未读指示
      setNewMessageCount((prev) => prev + (items.length - prevLength));
    }

    prevItemsLengthRef.current = items.length;
  }, [items.length, items[items.length - 1]?.id, (items[items.length - 1] as any)?.text]);

  // 处理空会话时的新建会话
  const handleCreateNewSession = async () => {
    if (!currentWorkspace) return;
    try {
      await createSession({
        workspaceId: currentWorkspace.id,
        title: '新会话',
      });
    } catch {
      // 忽略或由统一通知处理
    }
  };

  const effectiveCapabilities = mockCapabilities !== undefined ? mockCapabilities : capabilities;

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden bg-bg-app text-text-primary ${className}`}
      data-testid="manager-view"
    >
      {/* 1. 顶部状态警告条 ---------------------------------------------------- */}

      {/* 1.1 连接断开/重连中黄色醒目提示条 */}
      {/* ★ B-11：排除 connecting 初始状态，只在明确的断线/重连时显示 */}
      {(connectionStatus === 'reconnecting' || connectionStatus === 'closed') && (
        <div
          className="flex shrink-0 items-center justify-between border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-xs text-amber-300"
          data-testid="reconnecting-banner"
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="font-medium">连接中断，正在重连…</span>
          </div>
          <span className="font-mono text-[11px] text-amber-300/80">
            {`WS: ${connectionStatus}`}
          </span>
        </div>
      )}

      {/* 1.2 agy 版本升级提示条 */}
      {isAgyUpgradeDetected && (
        <div
          className="flex shrink-0 items-center justify-between border-b border-blue-500/30 bg-blue-500/15 px-4 py-2 text-xs text-blue-300"
          data-testid="upgrade-notice-banner"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium">agy 已升级，建议重新探测</span>
            {effectiveCapabilities?.agyVersion && effectiveCapabilities?.profileAgyVersion && (
              <span className="font-mono text-[11px] text-blue-200/80">
                {`(CLI: ${effectiveCapabilities.agyVersion} / Profile: ${effectiveCapabilities.profileAgyVersion})`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 2. 顶部会话标题栏 ---------------------------------------------------- */}
      {activeSessionId && (
        <header
          className="flex h-12 shrink-0 items-center justify-between border-b border-border-default bg-bg-panel/50 px-4 backdrop-blur-sm select-none"
          data-testid="manager-header"
        >
          <div className="flex items-center gap-2 min-w-0">
            <StatusDot
              status={
                slot?.activeRunId
                  ? 'running'
                  : currentSession?.status === 'running'
                  ? 'running'
                  : currentSession?.status === 'error'
                  ? 'failed'
                  : 'idle'
              }
              size="sm"
            />

            {isEditingTitle ? (
              <input
                ref={titleInputRef}
                type="text"
                value={editingTitleText}
                onChange={(e) => setEditingTitleText(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    if (e.key === 'Escape') handleCancelTitle();
                    // ★ B-9：统一通过 blur 触发保存/取消
                    e.currentTarget.blur();
                  }
                }}
                className="rounded border border-accent bg-bg-surface px-2 py-0.5 text-xs font-semibold text-text-primary outline-none ring-1 ring-accent"
                data-testid="session-title-input"
              />
            ) : (
              <div
                className="group flex items-center gap-2 cursor-pointer select-none"
                onDoubleClick={handleStartRename}
                title="双击就地重命名会话"
                data-testid="session-title"
              >
                <span className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors truncate max-w-md">
                  {currentSession?.title || '新会话'}
                </span>
                <span className="text-[10px] text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity">
                  (双击重命名)
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-text-tertiary">
            {slot?.activeRunId && (
              <span className="font-mono text-[11px] text-accent">运行中</span>
            )}
          </div>
        </header>
      )}

      {/* 3. 中间对话流展示区 -------------------------------------------------- */}
      <div className="relative flex flex-1 flex-col overflow-hidden min-h-0">
        {!activeSessionId ? (
          /* 3.1 未选择任何会话时的引导占位 */
          <div
            className="flex flex-1 flex-col items-center justify-center p-8 text-center text-text-secondary"
            data-testid="empty-session-placeholder"
          >
            <div className="max-w-md rounded-2xl border border-border-default bg-bg-surface p-8 shadow-lg">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent font-bold text-xl">
                A
              </div>
              <h2 className="text-lg font-bold text-text-primary">
                会话主视图 (ManagerView)
              </h2>
              <p className="mt-2 text-xs text-text-secondary leading-relaxed">
                未选择会话。从左侧收件箱选择已有会话，或点击下方按钮开启新任务。
              </p>
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={handleCreateNewSession}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white shadow hover:bg-accent/90 transition-colors"
                  data-testid="empty-create-session-btn"
                >
                  + 新建会话
                </button>
              </div>
            </div>
          </div>
        ) : items.length === 0 ? (
          /* 3.2 已选会话但暂无条目时的占位引导 */
          <div
            className="flex flex-1 flex-col items-center justify-center p-8 text-center text-text-secondary select-none"
            data-testid="empty-timeline-placeholder"
          >
            <div className="max-w-sm rounded-xl border border-dashed border-border-default bg-bg-surface/40 p-6">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent font-bold">
                ⚡
              </div>
              <h3 className="text-sm font-semibold text-text-primary">准备就绪</h3>
              <p className="mt-1.5 text-xs text-text-tertiary">
                在下方输入指令或任务需求开始对话。支持思考过程、子 Agent 自动派发与工具调用。
              </p>
            </div>
          </div>
        ) : (
          /* 3.3 虚拟滚动时间线列表 */
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto overflow-x-hidden p-4 min-h-0"
            data-testid="timeline-scroll-container"
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
              data-testid="virtual-timeline-container"
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const item = items[virtualRow.index];
                if (!item) return null;
                return (
                  <div
                    key={item.id ?? virtualRow.index}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="pb-3"
                  >
                    <TimelineItemDispatcher
                      item={item}
                      sessionId={activeSessionId}
                      thinkingHidden={showThinkingOverride === false}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 3.4 回到底部 (Scroll to bottom) 浮动按钮 */}
        {!isAtBottom && items.length > 0 && (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-4 right-6 z-20 flex items-center gap-1.5 rounded-full border border-border-default bg-bg-surface/90 px-3.5 py-1.5 text-xs font-medium text-text-primary shadow-lg backdrop-blur-md hover:bg-bg-surface-active hover:border-border-strong transition-all"
            data-testid="scroll-to-bottom-btn"
          >
            <span>↓ 回到底部</span>
            {newMessageCount > 0 && (
              <span
                className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white"
                data-testid="unread-badge"
              >
                {newMessageCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* 4. 底部固定 Composer 输入组件 ---------------------------------------- */}
      {activeSessionId && (
        <footer
          className="shrink-0 border-t border-border-default bg-bg-panel/40 p-3"
          data-testid="manager-composer-footer"
        >
          <Composer sessionId={activeSessionId} />
        </footer>
      )}
    </div>
  );
}
