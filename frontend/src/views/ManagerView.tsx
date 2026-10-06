import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { SubagentItem, TimelineItem, UserMessageItem } from '../domain/timeline.types';
import { buildDisplayRows, type DisplayRow } from '../domain/displayRows';
import { Composer } from '../components/composer';
import {
  AssistantIdentity,
  AssistantMessageRow,
  ErrorNotice,
  RunDivider,
  StalledNotice,
  StatusDot,
  SubagentCardContainer,
  UserMessageRow,
  WorkedBlock,
} from '../components/timeline';
import { useConnectionStore } from '../stores/connection.store';
import { EditResendError, useSessionStore } from '../stores/session.store';
import { resolveCurrentModelId, useModelsStore } from '../stores/models.store';
import { usePrefsStore } from '../stores/prefs.store';
import { useUiStore } from '../stores/ui.store';
import { useWorkspaceStore } from '../stores/workspace.store';
import { updateSession as apiUpdateSession } from '../api/endpoints';
import type { WsStatus } from '../api/ws';

export interface ManagerViewProps {
  /** 可选显式指定的 sessionId，未传时使用 sessionStore.activeSessionId */
  sessionId?: string;
  /** 可选注入的条目列表（用于测试或 Playground 覆盖） */
  initialItems?: TimelineItem[];
  /** 可选自定义类名 */
  className?: string;
  /** 可选显式注入的连接状态（用于测试覆盖） */
  connectionStatus?: WsStatus;
}

// ============================================================================
// 展示行渲染 (DisplayRowView)：消息平铺，工作步骤收进 Worked 块
// ============================================================================

export interface DisplayRowViewProps {
  row: DisplayRow;
  sessionId?: string;
  /**
   * 展开/收起的用户选择，键为 Worked 块 key、分组 key、toolCallId 或思考 id。
   * 保存在虚拟列表之外，行滚出再滚回时仍能恢复。
   */
  expandedChoices?: Readonly<Record<string, boolean>>;
  onExpandedChange?: (key: string, next: boolean) => void;
  /** Edit & resubmit a user message; omit to hide editing. */
  onEditUserMessage?: (item: UserMessageItem, text: string) => Promise<void>;
  /** Why user messages cannot be edited right now (e.g. a run is active). */
  editDisabledReason?: string | null;
}

export function DisplayRowView({
  row,
  sessionId,
  expandedChoices,
  onExpandedChange,
  onEditUserMessage,
  editDisabledReason = null,
}: DisplayRowViewProps) {
  const renderSubagent = useCallback(
    (item: SubagentItem) => (
      <div className="my-1" data-testid={`timeline-item-subagent-${item.id}`}>
        <SubagentCardContainer item={item} sessionId={sessionId} />
      </div>
    ),
    [sessionId],
  );

  switch (row.kind) {
    case 'user_message': {
      const item = row.item;
      return (
        <UserMessageRow
          item={item}
          onEdit={onEditUserMessage ? (text) => onEditUserMessage(item, text) : undefined}
          editDisabledReason={editDisabledReason}
        />
      );
    }

    case 'assistant_message':
      return (
        <div>
          {row.showIdentity && <AssistantIdentity streaming={!row.item.isComplete} />}
          <AssistantMessageRow item={row.item} />
        </div>
      );

    case 'worked':
      return (
        <div className="py-0.5" data-testid={`timeline-row-${row.key}`}>
          {row.showIdentity && <AssistantIdentity streaming={row.active} />}
          <WorkedBlock
            row={row}
            expandedChoices={expandedChoices}
            onExpandedChange={onExpandedChange}
            renderSubagent={renderSubagent}
          />
        </div>
      );

    case 'run_divider':
      return (
        <div data-testid={`timeline-item-run-divider-${row.item.id}`}>
          <RunDivider item={row.item} />
        </div>
      );

    case 'error':
      return (
        <div data-testid={`timeline-item-error-${row.item.id}`}>
          <ErrorNotice item={row.item} />
        </div>
      );

    case 'stalled_notice':
      return (
        <div data-testid={`timeline-item-stalled-${row.item.id}`}>
          <StalledNotice item={row.item} />
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
  const showThinkingPref = usePrefsStore((s) => s.prefs?.showThinking ?? true);

  // 会话插槽与时间线条目
  const slot = activeSessionId ? slots[activeSessionId] : undefined;
  const items = useMemo(() => {
    if (initialItems) return initialItems;
    return slot?.timeline.items ?? [];
  }, [initialItems, slot?.timeline.items]);

  const activeRunId = slot?.activeRunId ?? null;
  const editDisabledReason =
    slot?.activeRunId || slot?.pendingRunId ? '运行中无法编辑，请等运行结束' : null;

  // 编辑重问：回退成功但重发失败时原消息已删除，用横幅保留改好的文字
  const [editResendError, setEditResendError] = useState<{ message: string; text: string } | null>(null);
  const editMessage = sessionStore.editMessage;
  const handleEditUserMessage = useCallback(
    async (item: UserMessageItem, text: string) => {
      if (!activeSessionId) return;
      setEditResendError(null);
      const model = resolveCurrentModelId(useModelsStore.getState().models, usePrefsStore.getState().prefs);
      try {
        await editMessage(activeSessionId, item.messageId, text, {
          attachmentIds: item.attachments.length > 0 ? item.attachments.map((a) => a.id) : undefined,
          model,
        });
      } catch (err: unknown) {
        if (err instanceof EditResendError) {
          setEditResendError({ message: err.message, text: err.text });
          return;
        }
        throw err;
      }
    },
    [activeSessionId, editMessage],
  );
  // 本页临时开关优先，其次是设置页的「显示模型思考过程」
  const thinkingHidden = showThinkingOverride === null ? !showThinkingPref : !showThinkingOverride;
  const rows = useMemo(
    () => buildDisplayRows(items, { activeRunId, thinkingHidden }),
    [items, activeRunId, thinkingHidden],
  );

  const currentSession = useMemo(() => {
    return sessionList.find((s) => s.id === activeSessionId) ?? null;
  }, [sessionList, activeSessionId]);

  // 卡片展开/收起的用户选择，按会话保存；虚拟列表卸载行后仍能恢复
  const [expandedChoicesBySession, setExpandedChoicesBySession] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const expandedChoices = activeSessionId
    ? expandedChoicesBySession[activeSessionId]
    : undefined;
  const handleExpandedChange = useCallback(
    (key: string, next: boolean) => {
      if (!activeSessionId) return;
      setExpandedChoicesBySession((prev) => ({
        ...prev,
        [activeSessionId]: { ...prev[activeSessionId], [key]: next },
      }));
    },
    [activeSessionId],
  );

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
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 48,
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
        if (rows.length > 0) {
          rowVirtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
        }
      });
    }
  }, [activeSessionId]);

  // 新消息 / 内容增长时自动跟随或累加未读数
  const lastItem = items[items.length - 1];
  const lastItemText = lastItem && 'text' in lastItem ? lastItem.text : undefined;
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
  }, [items.length, lastItem?.id, lastItemText]);

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
          className="flex shrink-0 items-center justify-between border-b border-status-warning/30 bg-status-warning-subtle px-4 py-2 text-xs text-status-warning-text"
          data-testid="reconnecting-banner"
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-status-warning animate-pulse" />
            <span className="font-medium">连接中断，正在重连…</span>
          </div>
          <span className="font-mono text-[11px] opacity-80">
            {`WS: ${connectionStatus}`}
          </span>
        </div>
      )}

      {/* 1.2 编辑重问：已回退但重新发送失败 */}
      {editResendError && (
        <div
          className="flex shrink-0 items-start justify-between gap-3 border-b border-status-error/30 bg-status-error-subtle px-4 py-2 text-xs text-status-error-text"
          data-testid="edit-resend-error-banner"
        >
          <div className="min-w-0">
            <div className="font-medium">已删除原消息之后的回答，但重新发送失败：{editResendError.message}</div>
            <div className="mt-1 whitespace-pre-wrap break-words text-text-secondary">你改好的内容：{editResendError.text}</div>
          </div>
          <button
            type="button"
            onClick={() => setEditResendError(null)}
            className="shrink-0 rounded px-1.5 hover:bg-status-error/10"
            title="关闭"
          >
            ✕
          </button>
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
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-accent-foreground shadow hover:bg-accent-hover transition-colors"
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
            className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4 min-h-0"
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
                const row = rows[virtualRow.index];
                if (!row) return null;
                return (
                  <div
                    key={row.key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="pb-1"
                  >
                    <div className="mx-auto max-w-5xl">
                      <DisplayRowView
                        row={row}
                        sessionId={activeSessionId}
                        expandedChoices={expandedChoices}
                        onExpandedChange={handleExpandedChange}
                        onEditUserMessage={handleEditUserMessage}
                        editDisabledReason={editDisabledReason}
                      />
                    </div>
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
                className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground"
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
          <div className="mx-auto max-w-5xl">
            <Composer sessionId={activeSessionId} />
          </div>
        </footer>
      )}
    </div>
  );
}
