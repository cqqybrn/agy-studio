import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Artifact, Checkpoint } from '@agy-studio/contracts';
import { getArtifactRaw, getArtifacts, getCheckpoints } from '../../api/endpoints';
import { useSessionStore } from '../../stores/session.store';
import { useUiStore } from '../../stores/ui.store';
import { LoadingSpinner } from '../timeline/icons';
import { ChangesView } from './ChangesView';
import { MarkdownArtifactView } from './MarkdownArtifactView';
import { isImageArtifact, isVideoArtifact, MediaGallery } from './MediaGallery';
import { TaskView } from './TaskView';

export type ArtifactTabKey = 'Task' | 'Plan' | 'Walkthrough' | 'Media' | 'Changes';

export const ARTIFACT_TABS: { key: ArtifactTabKey; label: string }[] = [
  { key: 'Task', label: 'Task' },
  { key: 'Plan', label: 'Plan' },
  { key: 'Walkthrough', label: 'Walkthrough' },
  { key: 'Media', label: 'Media' },
  { key: 'Changes', label: 'Changes' },
];

export function findTaskArtifact(artifacts: Artifact[]): Artifact | undefined {
  return artifacts.find(
    (a) =>
      a.kind === 'task' ||
      a.name.toLowerCase() === 'task.md' ||
      a.relativePath.toLowerCase().endsWith('task.md'),
  );
}

export function findPlanArtifact(artifacts: Artifact[]): Artifact | undefined {
  return artifacts.find(
    (a) =>
      a.kind === 'implementation_plan' ||
      a.name.toLowerCase() === 'implementation_plan.md' ||
      a.relativePath.toLowerCase().endsWith('implementation_plan.md'),
  );
}

export function findWalkthroughArtifact(artifacts: Artifact[]): Artifact | undefined {
  return artifacts.find(
    (a) =>
      a.kind === 'walkthrough' ||
      a.name.toLowerCase() === 'walkthrough.md' ||
      a.relativePath.toLowerCase().endsWith('walkthrough.md'),
  );
}

export function findMediaArtifacts(artifacts: Artifact[]): Artifact[] {
  return artifacts.filter((a) => isImageArtifact(a) || isVideoArtifact(a));
}

export function getTabContentMap(
  artifacts: Artifact[],
  hasChanges = false,
): Record<ArtifactTabKey, boolean> {
  const hasTask = Boolean(findTaskArtifact(artifacts));
  const hasPlan = Boolean(findPlanArtifact(artifacts));
  const hasWalkthrough = Boolean(findWalkthroughArtifact(artifacts));
  const hasMedia = findMediaArtifacts(artifacts).length > 0;

  return {
    Task: hasTask,
    Plan: hasPlan,
    Walkthrough: hasWalkthrough,
    Media: hasMedia,
    Changes: hasChanges,
  };
}

async function extractBlobText(blob: Blob | any): Promise<string> {
  if (typeof blob === 'string') return blob;
  if (!blob) return '';
  if (typeof blob.text === 'function') {
    return await blob.text();
  }
  if (typeof blob.arrayBuffer === 'function') {
    const buffer = await blob.arrayBuffer();
    return new TextDecoder().decode(buffer);
  }
  return '';
}

export interface ArtifactTabsProps {
  sessionId?: string | null;
  onClose?: () => void;
  className?: string;
}

export function ArtifactTabs({
  sessionId: propSessionId,
  onClose,
  className = '',
}: ArtifactTabsProps) {
  const storeSessionId =
    typeof window === 'undefined'
      ? useSessionStore.getState().activeSessionId ?? useSessionStore((s) => s.activeSessionId)
      : useSessionStore((s) => s.activeSessionId);
  const sessionId = propSessionId !== undefined ? propSessionId : storeSessionId;

  const storeActiveTab = useUiStore((s) => s.activeArtifactTab);
  const activeTab = (
    typeof window === 'undefined'
      ? (useUiStore.getState().activeArtifactTab || storeActiveTab)
      : storeActiveTab
  ) as ArtifactTabKey;
  const setActiveTab = useUiStore((s) => s.setActiveArtifactTab);

  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const [rawContents, setRawContents] = useState<Record<string, string>>({});
  const [rawLoadingMap, setRawLoadingMap] = useState<Record<string, boolean>>({});

  // 1.5s 短暂渐变高亮状态
  const [highlightedArtifactId, setHighlightedArtifactId] = useState<string | null>(null);
  const [highlightedTab, setHighlightedTab] = useState<ArtifactTabKey | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 跟踪已消费的事件游标，用于捕获 artifact.updated 事件
  const slot = useSessionStore((s) => (sessionId ? s.slots[sessionId] : null));
  const lastProcessedEventsCountRef = useRef(0);

  // 加载 artifacts 列表
  const fetchArtifactsList = useCallback(
    async (targetSessionId: string) => {
      try {
        setListLoading(true);
        const list = await getArtifacts(targetSessionId);
        setArtifacts(list);
        return list;
      } catch (err) {
        console.warn('Failed to fetch artifacts for session:', targetSessionId, err);
        setArtifacts([]);
        return [];
      } finally {
        setListLoading(false);
      }
    },
    [],
  );

  // 加载 checkpoints 列表
  const fetchCheckpointsList = useCallback(
    async (targetSessionId: string) => {
      try {
        setCheckpointsLoading(true);
        const list = await getCheckpoints(targetSessionId);
        setCheckpoints(list);
        return list;
      } catch (err) {
        console.warn('Failed to fetch checkpoints for session:', targetSessionId, err);
        setCheckpoints([]);
        return [];
      } finally {
        setCheckpointsLoading(false);
      }
    },
    [],
  );

  // 加载单项 raw 文本内容
  const fetchRawText = useCallback(
    async (targetSessionId: string, artifact: Artifact, triggerHighlight = false) => {
      try {
        setRawLoadingMap((prev) => ({ ...prev, [artifact.id]: true }));
        const blob = await getArtifactRaw(targetSessionId, artifact.id);
        const text = await extractBlobText(blob);
        setRawContents((prev) => ({ ...prev, [artifact.id]: text }));

        if (triggerHighlight) {
          triggerHighlightForArtifact(artifact);
        }
      } catch (err) {
        console.warn('Failed to fetch artifact raw:', artifact.id, err);
      } finally {
        setRawLoadingMap((prev) => ({ ...prev, [artifact.id]: false }));
      }
    },
    [],
  );

  const triggerHighlightForArtifact = (artifact: Artifact) => {
    setHighlightedArtifactId(artifact.id);
    let matchedTab: ArtifactTabKey = 'Task';
    if (artifact.kind === 'task' || artifact.name.toLowerCase().includes('task')) {
      matchedTab = 'Task';
    } else if (
      artifact.kind === 'implementation_plan' ||
      artifact.name.toLowerCase().includes('plan')
    ) {
      matchedTab = 'Plan';
    } else if (
      artifact.kind === 'walkthrough' ||
      artifact.name.toLowerCase().includes('walkthrough')
    ) {
      matchedTab = 'Walkthrough';
    } else if (isImageArtifact(artifact) || isVideoArtifact(artifact)) {
      matchedTab = 'Media';
    }
    setHighlightedTab(matchedTab);

    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedArtifactId(null);
      setHighlightedTab(null);
    }, 1500);
  };

  // 会话切换时，重置并拉取新会话的 artifacts 与 checkpoints
  useEffect(() => {
    setArtifacts([]);
    setCheckpoints([]);
    setRawContents({});
    setRawLoadingMap({});
    setHighlightedArtifactId(null);
    setHighlightedTab(null);
    lastProcessedEventsCountRef.current = 0;

    if (sessionId) {
      void fetchArtifactsList(sessionId);
      void fetchCheckpointsList(sessionId);
    }

    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, [sessionId, fetchArtifactsList, fetchCheckpointsList]);

  // 监听会话槽位事件：捕获 artifact.updated 以及 run 运行事件实时刷新
  useEffect(() => {
    if (!slot || !sessionId) return;

    const events = slot.events;
    if (events.length <= lastProcessedEventsCountRef.current) {
      return;
    }

    const newEnvelopes = events.slice(lastProcessedEventsCountRef.current);
    lastProcessedEventsCountRef.current = events.length;

    for (const envelope of newEnvelopes) {
      if (envelope.event.type === 'artifact.updated') {
        const updatedArtifact = envelope.event.artifact;
        // 重新拉取 artifacts 列表
        void fetchArtifactsList(sessionId);
        // 若为文本型产物，重新加载其 raw 内容并触发 1.5s 渐变高亮
        void fetchRawText(sessionId, updatedArtifact, true);
      } else if (
        envelope.event.type === 'run.started' ||
        envelope.event.type === 'run.completed'
      ) {
        void fetchCheckpointsList(sessionId);
      }
    }
  }, [slot, sessionId, fetchArtifactsList, fetchCheckpointsList, fetchRawText]);

  // 计算各标签页是否存在内容
  const hasChanges = checkpoints.length > 0;
  const tabContentMap = useMemo(
    () => getTabContentMap(artifacts, hasChanges),
    [artifacts, hasChanges],
  );

  const taskArtifact = useMemo(() => findTaskArtifact(artifacts), [artifacts]);
  const planArtifact = useMemo(() => findPlanArtifact(artifacts), [artifacts]);
  const walkthroughArtifact = useMemo(() => findWalkthroughArtifact(artifacts), [artifacts]);
  const mediaArtifacts = useMemo(() => findMediaArtifacts(artifacts), [artifacts]);

  // 激活当前标签页时按需拉取对应 raw 内容
  useEffect(() => {
    if (!sessionId) return;

    if (activeTab === 'Task' && taskArtifact && rawContents[taskArtifact.id] === undefined) {
      void fetchRawText(sessionId, taskArtifact);
    } else if (
      activeTab === 'Plan' &&
      planArtifact &&
      rawContents[planArtifact.id] === undefined
    ) {
      void fetchRawText(sessionId, planArtifact);
    } else if (
      activeTab === 'Walkthrough' &&
      walkthroughArtifact &&
      rawContents[walkthroughArtifact.id] === undefined
    ) {
      void fetchRawText(sessionId, walkthroughArtifact);
    }
  }, [
    activeTab,
    sessionId,
    taskArtifact,
    planArtifact,
    walkthroughArtifact,
    rawContents,
    fetchRawText,
  ]);

  const handleTabClick = (tabKey: ArtifactTabKey) => {
    if (!tabContentMap[tabKey]) return;
    setActiveTab(tabKey);
  };

  // 空状态处理：未选择会话
  if (!sessionId) {
    return (
      <div
        className={`flex h-full flex-col bg-bg-panel ${className}`}
        data-testid="artifacts-panel"
      >
        <div className="flex h-10 items-center justify-between border-b border-border-default px-3 text-xs font-medium text-text-secondary">
          <span className="text-text-primary">Artifacts</span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-text-tertiary hover:bg-bg-surface hover:text-text-primary"
              data-testid="collapse-right-btn"
              title="折叠面板"
            >
              ✕
            </button>
          )}
        </div>
        <div
          className="flex flex-1 flex-col items-center justify-center p-6 text-center text-text-tertiary"
          data-testid="artifacts-no-session"
        >
          <span className="text-sm font-medium text-text-secondary">未选择会话</span>
          <p className="mt-1 text-xs">请在左侧列表中选择或新建一个会话以查看对应的生成产物</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full flex-col bg-bg-panel ${className}`}
      data-testid="artifacts-panel"
    >
      {/* 顶部标题栏 */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-default px-3 text-xs font-medium">
        <div className="flex items-center gap-2">
          <span className="text-text-primary font-semibold">Artifacts</span>
          {listLoading && <LoadingSpinner className="h-3 w-3 animate-spin text-accent" />}
          {highlightedTab && (
            <span
              className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-500 font-semibold animate-pulse"
              data-testid="artifact-updated-indicator"
            >
              {highlightedTab} 已更新
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (sessionId) {
                void fetchArtifactsList(sessionId);
                void fetchCheckpointsList(sessionId);
              }
            }}
            className="rounded p-1 text-text-tertiary hover:bg-bg-surface hover:text-text-primary transition-colors"
            title="手动刷新产物列表"
            data-testid="refresh-artifacts-btn"
          >
            ↻
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-text-tertiary hover:bg-bg-surface hover:text-text-primary transition-colors"
              title="折叠面板"
              data-testid="collapse-right-btn"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 标签页导航栏 */}
      <div
        className="flex shrink-0 border-b border-border-default bg-bg-surface/50 px-2 py-1 text-xs"
        role="tablist"
        data-testid="artifact-tabs-bar"
      >
        {ARTIFACT_TABS.map((tab) => {
          const hasContent = tabContentMap[tab.key];
          const isActive = activeTab === tab.key;
          const isTabHighlighted = highlightedTab === tab.key;

          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-disabled={!hasContent}
              disabled={!hasContent}
              onClick={() => handleTabClick(tab.key)}
              data-testid={`artifact-tab-${tab.key.toLowerCase()}`}
              className={`relative flex items-center gap-1 rounded-md px-2.5 py-1.5 font-medium transition-all ${
                !hasContent
                  ? 'cursor-not-allowed opacity-40 text-text-tertiary'
                  : isActive
                  ? 'bg-accent/15 text-accent shadow-sm'
                  : 'text-text-secondary hover:bg-bg-surface hover:text-text-primary cursor-pointer'
              } ${isTabHighlighted ? 'ring-2 ring-amber-500/70' : ''}`}
            >
              <span>{tab.label}</span>
              {/* 若该标签有内容则展示小圆点提示 */}
              {hasContent && !isActive && (
                <span className="h-1.5 w-1.5 rounded-full bg-accent/60" />
              )}
            </button>
          );
        })}
      </div>

      {/* 内容展示区 */}
      <div className="flex-1 overflow-y-auto" data-testid="artifact-tab-content">
        {activeTab !== 'Changes' && artifacts.length === 0 && !listLoading ? (
          <div
            className="flex h-64 flex-col items-center justify-center p-6 text-center text-text-tertiary"
            data-testid="artifacts-empty-state"
          >
            <div className="rounded-lg border border-dashed border-border-default p-6">
              <p className="text-sm font-medium text-text-secondary">当前会话暂无生成产物</p>
              <p className="mt-1 text-xs">
                当任务执行时，自动生成的任务清单、实施计划与截屏录屏将在此展示
              </p>
            </div>
          </div>
        ) : (
          <>
            {activeTab === 'Task' && (
              <TaskView
                content={taskArtifact ? rawContents[taskArtifact.id] ?? '' : ''}
                loading={taskArtifact ? rawLoadingMap[taskArtifact.id] ?? false : false}
                isHighlighted={Boolean(
                  taskArtifact && highlightedArtifactId === taskArtifact.id,
                )}
              />
            )}

            {activeTab === 'Plan' && (
              <MarkdownArtifactView
                content={planArtifact ? rawContents[planArtifact.id] ?? '' : ''}
                sessionId={sessionId}
                isPlan={true}
                loading={planArtifact ? rawLoadingMap[planArtifact.id] ?? false : false}
                isHighlighted={Boolean(
                  planArtifact && highlightedArtifactId === planArtifact.id,
                )}
              />
            )}

            {activeTab === 'Walkthrough' && (
              <MarkdownArtifactView
                content={walkthroughArtifact ? rawContents[walkthroughArtifact.id] ?? '' : ''}
                sessionId={sessionId}
                isPlan={false}
                loading={
                  walkthroughArtifact ? rawLoadingMap[walkthroughArtifact.id] ?? false : false
                }
                isHighlighted={Boolean(
                  walkthroughArtifact && highlightedArtifactId === walkthroughArtifact.id,
                )}
              />
            )}

            {activeTab === 'Media' && (
              <MediaGallery
                artifacts={mediaArtifacts}
                sessionId={sessionId}
                highlightedArtifactId={highlightedArtifactId}
              />
            )}

            {activeTab === 'Changes' && (
              <ChangesView
                sessionId={sessionId}
                checkpoints={checkpoints}
                onCheckpointsLoaded={setCheckpoints}
                onRollbackSuccess={() => {
                  if (sessionId) {
                    void fetchCheckpointsList(sessionId);
                  }
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
