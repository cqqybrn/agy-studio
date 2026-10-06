import React, { useEffect } from 'react';
import type { Session } from '@agy-studio/contracts';
import { useSessionStore } from '../../stores/session.store';
import { useUiStore } from '../../stores/ui.store';
import { useWorkspaceStore } from '../../stores/workspace.store';
import { InboxItem } from './InboxItem';

/** What the dot left of a session title shows. */
export type InboxIndicator = 'running' | 'unread' | 'none';

/**
 * running: a run is in progress; unread: finished with output not yet seen;
 * none: seen (the open session counts as seen).
 */
export function inboxIndicator(session: Session, readSeq: number, isActive: boolean): InboxIndicator {
  if (session.status === 'running') return 'running';
  if (!isActive && readSeq < session.lastSeq) return 'unread';
  return 'none';
}

/** Most recent activity first. */
export function sortSessionsByActivity(sessions: readonly Session[]): Session[] {
  const time = (s: Session) => Date.parse(s.updatedAt || s.createdAt) || 0;
  return [...sessions].sort((a, b) => time(b) - time(a));
}

/** Each workspace has its own session list; with no workspace selected, everything is shown. */
export function sessionsOfWorkspace(sessions: readonly Session[], workspaceId: string | null): Session[] {
  return workspaceId ? sessions.filter((s) => s.workspaceId === workspaceId) : [...sessions];
}

export interface InboxListProps {
  sessions?: Session[];
  readSeqMap?: Record<string, number>;
  isIsolatedHome?: boolean;
}

export function InboxList({
  sessions: propSessions,
  readSeqMap: propReadSeqMap,
  isIsolatedHome,
}: InboxListProps) {
  const hookSessions = useSessionStore((s) => s.list);
  const hookActiveSessionId = useSessionStore((s) => s.activeSessionId);
  const hookReadSeqMap = useUiStore((s) => s.readSeqMap);
  const hookWorkspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id ?? null);

  // Server rendering (tests) gets the stores' initial state from the hooks; fall back to the live state.
  const storeSessions = hookSessions.length > 0 ? hookSessions : useSessionStore.getState().list;
  const activeSessionId = hookActiveSessionId ?? useSessionStore.getState().activeSessionId;
  const currentWorkspaceId = hookWorkspaceId ?? useWorkspaceStore.getState().currentWorkspace?.id ?? null;
  const sessions = propSessions ?? sessionsOfWorkspace(storeSessions, currentWorkspaceId);
  const readSeqMap =
    propReadSeqMap ??
    (Object.keys(hookReadSeqMap).length > 0 ? hookReadSeqMap : useUiStore.getState().readSeqMap);

  // 第一次使用时，已有的历史会话都算已读，避免满屏蓝点
  useEffect(() => {
    if (!propSessions && storeSessions.length > 0) {
      useUiStore.getState().seedReadSeq(storeSessions);
    }
  }, [propSessions, storeSessions]);

  // 切换到别的工作区后，关掉属于其他工作区的会话
  const activeWorkspaceId = storeSessions.find((s) => s.id === activeSessionId)?.workspaceId;
  useEffect(() => {
    if (!propSessions && currentWorkspaceId && activeWorkspaceId && activeWorkspaceId !== currentWorkspaceId) {
      useSessionStore.getState().setActiveSessionId(null);
    }
  }, [propSessions, currentWorkspaceId, activeWorkspaceId]);

  // 正在看的会话，新内容到达即视为已读
  const activeLastSeq = sessions.find((s) => s.id === activeSessionId)?.lastSeq;
  useEffect(() => {
    if (activeSessionId && activeLastSeq !== undefined) {
      useUiStore.getState().markSessionAsRead(activeSessionId, activeLastSeq);
    }
  }, [activeSessionId, activeLastSeq]);

  if (sessions.length === 0) {
    return (
      <div
        data-testid="inbox-list"
        className="flex flex-1 flex-col items-center justify-center p-6 text-center text-text-tertiary"
      >
        <p className="text-xs">{currentWorkspaceId ? '这个工作区还没有会话' : '暂无会话'}</p>
        <p className="mt-1 text-[11px]">点击上方“+ 新建会话”开始对话</p>
      </div>
    );
  }

  return (
    <div data-testid="inbox-list" className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
      {sortSessionsByActivity(sessions).map((session) => (
        <InboxItem
          key={session.id}
          session={session}
          indicator={inboxIndicator(
            session,
            readSeqMap[session.id] ?? 0,
            session.id === activeSessionId,
          )}
          isIsolatedHome={isIsolatedHome}
        />
      ))}
    </div>
  );
}
