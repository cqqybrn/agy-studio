import React, { useCallback, useEffect, useState } from 'react';
import type { TranscriptStep } from '@agy-studio/contracts';
import { getSubagentTranscript } from '../../api/endpoints';
import type { SubagentItem } from '../../domain/timeline.types';
import { useSessionStore } from '../../stores/session.store';
import { SubagentCard } from './SubagentCard';

export interface SubagentCardContainerProps {
  item: SubagentItem;
  /** 会话 ID，未提供时自动从 useSessionStore 中获取 activeSessionId */
  sessionId?: string;
  /** 初始展开状态 */
  defaultExpanded?: boolean;
  /** 自定义外层样式 */
  className?: string;
}

/**
 * 子 agent 运行期间轮询其 transcript 的间隔。agy 的 stream 只推送 subagent.spawned，
 * 子 agent 自己的步骤只写在它的 transcript 里，所以运行中要主动去读。
 */
export const SUBAGENT_POLL_MS = 3000;

/**
 * 模块级内存缓存，缓存在组件外。
 * 键为 `${sessionId}:${conversationId}`，反复折叠/展开只请求一次。
 */
export const subagentTranscriptCache = new Map<string, TranscriptStep[]>();

/**
 * 正在进行中的请求 Promise，防止同一 conversationId 在并发状态下重复发请求。
 */
export const subagentInflightRequests = new Map<
  string,
  Promise<{ steps: TranscriptStep[]; total: number }>
>();

/** 清空模块级缓存（测试与重置使用） */
export function clearSubagentTranscriptCache(): void {
  subagentTranscriptCache.clear();
  subagentInflightRequests.clear();
}

/** 读取模块级缓存中的步骤 */
export function getSubagentTranscriptFromCache(key: string): TranscriptStep[] | undefined {
  return subagentTranscriptCache.get(key);
}

/** 手动设置模块级缓存（测试或预热使用） */
export function setSubagentTranscriptInCache(key: string, steps: TranscriptStep[]): void {
  subagentTranscriptCache.set(key, steps);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return '获取子 Agent 执行步骤失败';
}

export function SubagentCardContainer({
  item,
  sessionId: explicitSessionId,
  defaultExpanded = false,
  className = '',
}: SubagentCardContainerProps) {
  // 会话 ID 处理
  const storeSessionId = useSessionStore((s) => s.activeSessionId);
  const targetSessionId = explicitSessionId || storeSessionId || 'default';
  const cacheKey = `${targetSessionId}:${item.conversationId}`;

  const isRunning = item.status === 'running';
  const hasItemSteps = Boolean(item.steps && item.steps.length > 0);

  // 展开状态
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);

  // 本地异步加载状态
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedSteps, setLoadedSteps] = useState<TranscriptStep[] | null>(() => {
    return subagentTranscriptCache.get(cacheKey) || null;
  });

  // 是否需要懒加载：只有在已结束且本地没有完整步骤且外部缓存未命中时才需要
  const cachedSteps = subagentTranscriptCache.get(cacheKey);
  const shouldLazyLoad = !isRunning && !hasItemSteps && !cachedSteps;

  const fetchTranscript = useCallback(async () => {
    if (isRunning || hasItemSteps) {
      return;
    }

    if (subagentTranscriptCache.has(cacheKey)) {
      setLoadedSteps(subagentTranscriptCache.get(cacheKey)!);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let inflight = subagentInflightRequests.get(cacheKey);
      if (!inflight) {
        inflight = getSubagentTranscript(targetSessionId, item.conversationId);
        subagentInflightRequests.set(cacheKey, inflight);
      }

      const res = await inflight;
      subagentTranscriptCache.set(cacheKey, res.steps);
      setLoadedSteps(res.steps);
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      subagentInflightRequests.delete(cacheKey);
      setIsLoading(false);
    }
  }, [cacheKey, hasItemSteps, isRunning, item.conversationId, targetSessionId]);

  // 运行中：定时读取子 agent 的 transcript（折叠时也读，标题栏实时显示步数）。
  // 结果不进缓存，运行结束后展开时按完整 transcript 重新加载。
  useEffect(() => {
    if (!isRunning || hasItemSteps) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await getSubagentTranscript(targetSessionId, item.conversationId);
        if (cancelled) return;
        setLoadedSteps(res.steps);
        setError(null);
      } catch {
        // 子 agent 刚启动时 transcript 可能还不存在，下一轮再试
      }
      if (!cancelled) timer = setTimeout(poll, SUBAGENT_POLL_MS);
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isRunning, hasItemSteps, targetSessionId, item.conversationId]);

  // 展开时按需懒加载
  useEffect(() => {
    if (isExpanded && shouldLazyLoad && !isLoading && !error) {
      void fetchTranscript();
    }
  }, [isExpanded, shouldLazyLoad, isLoading, error, fetchTranscript]);

  // ★ 修复 A-8：运行期间同步 steps 到缓存，保证 Store 释放内存时能无缝 fallback
  useEffect(() => {
    if (isRunning && item.steps && item.steps.length > 0) {
      subagentTranscriptCache.set(cacheKey, item.steps);
      setLoadedSteps(item.steps);
    }
  }, [isRunning, item.steps, cacheKey]);

  const handleToggleExpand = () => {
    const nextState = !isExpanded;
    setIsExpanded(nextState);
    if (nextState && shouldLazyLoad && !isLoading) {
      void fetchTranscript();
    }
  };

  const handleRetry = () => {
    subagentInflightRequests.delete(cacheKey);
    void fetchTranscript();
  };

  // 步骤优先级：
  // 1. item 中已有 steps（事件流推送的）：直接使用
  // 2. 运行中：使用轮询得到的 steps
  // 3. 已结束：缓存 → 本地已加载 → 空数组
  const effectiveSteps: TranscriptStep[] = hasItemSteps
    ? item.steps
    : isRunning
      ? loadedSteps ?? []
      : cachedSteps ?? loadedSteps ?? [];

  return (
    <SubagentCard
      item={item}
      steps={effectiveSteps}
      isExpanded={isExpanded}
      onToggleExpand={handleToggleExpand}
      isLoading={isLoading || (isRunning && !hasItemSteps && loadedSteps === null)}
      error={error}
      onRetry={handleRetry}
      className={className}
      defaultExpanded={defaultExpanded}
    />
  );
}
