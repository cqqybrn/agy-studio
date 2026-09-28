import React, { useState } from 'react';
import type { Session } from '@agy-studio/contracts';
import { StatusDot } from '../timeline/StatusDot';
import { useSessionStore } from '../../stores/session.store';
import { useUiStore } from '../../stores/ui.store';
import { InboxItem } from './InboxItem';

export type InboxGroupKey = 'running' | 'attention' | 'completed';

export interface GroupedSessions {
  running: Session[];
  attention: Session[];
  completed: Session[];
}

export function groupSessions(
  sessions: Session[],
  readSeqMap: Record<string, number>,
): GroupedSessions {
  const running: Session[] = [];
  const attention: Session[] = [];
  const completed: Session[] = [];

  for (const session of sessions) {
    if (session.status === 'running') {
      running.push(session);
    } else {
      const readSeq = readSeqMap[session.id] ?? 0;
      if (readSeq < session.lastSeq) {
        attention.push(session);
      } else {
        completed.push(session);
      }
    }
  }

  return { running, attention, completed };
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
  const storeSessions = useSessionStore((s) => s.list);
  const storeReadSeqMap = useUiStore((s) => s.readSeqMap);

  const currentList = storeSessions.length > 0 ? storeSessions : useSessionStore.getState().list;
  const currentReadSeq = Object.keys(storeReadSeqMap).length > 0 ? storeReadSeqMap : useUiStore.getState().readSeqMap;

  const sessions = propSessions ?? currentList;
  const readSeqMap = propReadSeqMap ?? currentReadSeq;

  const [collapsed, setCollapsed] = useState<Record<InboxGroupKey, boolean>>({
    running: false,
    attention: false,
    completed: false,
  });

  const toggleGroup = (key: InboxGroupKey) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const grouped = groupSessions(sessions, readSeqMap);

  const groups: Array<{
    key: InboxGroupKey;
    label: string;
    items: Session[];
    indicator: React.ReactNode;
  }> = [
    {
      key: 'running',
      label: '运行中',
      items: grouped.running,
      indicator: <StatusDot status="running" size="sm" />,
    },
    {
      key: 'attention',
      label: '待查看',
      items: grouped.attention,
      indicator: <span className="h-2 w-2 rounded-full bg-status-warning" />,
    },
    {
      key: 'completed',
      label: '已完成',
      items: grouped.completed,
      indicator: <span className="h-2 w-2 rounded-full bg-status-success" />,
    },
  ];

  if (sessions.length === 0) {
    return (
      <div
        data-testid="inbox-list"
        className="flex flex-1 flex-col items-center justify-center p-6 text-center text-text-tertiary"
      >
        <p className="text-xs">暂无会话</p>
        <p className="mt-1 text-[11px]">点击上方“+ 新建会话”开始对话</p>
      </div>
    );
  }

  return (
    <div
      data-testid="inbox-list"
      className="flex flex-1 flex-col space-y-3 overflow-y-auto p-2"
    >
      {groups.map(({ key, label, items, indicator }) => {
        const isCollapsed = collapsed[key];

        return (
          <div key={key} data-testid={`group-${key}`} className="flex flex-col">
            {/* 分组头部：折叠展开切换与计数 */}
            <button
              type="button"
              data-testid={`group-header-${key}`}
              onClick={() => toggleGroup(key)}
              className="flex items-center justify-between rounded px-1.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-surface hover:text-text-primary transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-tertiary">
                  {isCollapsed ? '▸' : '▾'}
                </span>
                {indicator}
                <span>{label}</span>
              </div>
              <span
                data-testid={`group-count-${key}`}
                className="rounded-full bg-bg-surface px-1.5 py-0.2 font-mono text-[10px] text-text-tertiary"
              >
                {items.length}
              </span>
            </button>

            {/* 分组内容列表 */}
            {!isCollapsed && (
              <div
                data-testid={`group-list-${key}`}
                className="mt-1 space-y-1 pl-1"
              >
                {items.length === 0 ? (
                  <div className="px-3 py-1.5 text-[11px] text-text-tertiary">
                    无会话
                  </div>
                ) : (
                  items.map((session) => (
                    <InboxItem
                      key={session.id}
                      session={session}
                      isIsolatedHome={isIsolatedHome}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
