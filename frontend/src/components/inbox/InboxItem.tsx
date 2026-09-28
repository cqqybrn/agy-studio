import React, { useState } from 'react';
import type { Session } from '@agy-studio/contracts';
import { StatusDot } from '../timeline/StatusDot';
import { useAccountStore } from '../../stores/account.store';
import { useSessionStore } from '../../stores/session.store';
import { useUiStore } from '../../stores/ui.store';

export function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  const time = date.getTime();
  if (Number.isNaN(time)) return '';
  const now = Date.now();
  const diff = now - time;

  if (diff < 0) return '刚刚';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const currentYear = new Date().getFullYear();
  return year === currentYear ? `${month}-${day}` : `${year}-${month}-${day}`;
}

export function useIsIsolatedHome(propIsolatedHome?: boolean): boolean {
  const storeWhoami = useAccountStore((s) => s.whoami);
  const storeAccounts = useAccountStore((s) => s.accounts);
  if (typeof propIsolatedHome === 'boolean') {
    return propIsolatedHome;
  }
  const whoami = storeWhoami ?? useAccountStore.getState().whoami;
  const accounts = storeAccounts.length > 0 ? storeAccounts : useAccountStore.getState().accounts;
  return (
    whoami?.isolation === 'isolated_home' ||
    accounts.some((a) => a.isolation === 'isolated_home')
  );
}

export interface InboxItemProps {
  session: Session;
  isActive?: boolean;
  isIsolatedHome?: boolean;
  onClick?: (session: Session) => void;
  onDelete?: (session: Session) => void;
}

export function InboxItem({
  session,
  isActive,
  isIsolatedHome: propIsolatedHome,
  onClick,
  onDelete,
}: InboxItemProps) {
  const storeActiveSessionId = useSessionStore((s) => s.activeSessionId);
  const activeSessionId = storeActiveSessionId ?? useSessionStore.getState().activeSessionId;
  const isIsolatedHome = useIsIsolatedHome(propIsolatedHome);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isCurrentActive = isActive ?? (activeSessionId === session.id);
  const relativeTime = formatRelativeTime(session.updatedAt || session.createdAt);
  const title = session.title?.trim() || '新会话';

  const handleClick = () => {
    useSessionStore.getState().setActiveSessionId(session.id);
    useUiStore.getState().markSessionAsRead(session.id, session.lastSeq);
    onClick?.(session);
  };

  const handleDeleteTrigger = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsConfirmingDelete(true);
  };

  const handleConfirmDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDeleting(true);
    try {
      await useSessionStore.getState().deleteSession(session.id);
      onDelete?.(session);
    } catch (err) {
      console.error('Failed to delete session', err);
    } finally {
      setIsDeleting(false);
      setIsConfirmingDelete(false);
    }
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsConfirmingDelete(false);
  };

  return (
    <div
      data-testid={`inbox-item-${session.id}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick();
        }
      }}
      className={`group relative flex cursor-pointer flex-col gap-1 rounded-md border px-2.5 py-2 text-xs transition-colors select-none ${
        isCurrentActive
          ? 'border-accent/50 bg-bg-surface-active font-medium text-text-primary shadow-sm'
          : 'border-border-subtle bg-bg-surface text-text-secondary hover:border-border-strong hover:bg-bg-surface-hover hover:text-text-primary'
      }`}
    >
      {/* 顶行：标题、账号标签、相对时间 */}
      <div className="flex items-center justify-between gap-1.5 overflow-hidden">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <StatusDot status={session.status} size="sm" />
          <span className="truncate font-medium text-text-primary" title={title}>
            {title}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isIsolatedHome && session.accountName && (
            <span
              data-testid="inbox-item-account"
              className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-mono text-accent"
              title={`所属账号: ${session.accountName}`}
            >
              {session.accountName}
            </span>
          )}
          {relativeTime && (
            <span className="text-[10px] text-text-tertiary">{relativeTime}</span>
          )}
        </div>
      </div>

      {/* 底行：次要信息或删除按钮 */}
      <div className="flex items-center justify-between text-[11px] text-text-tertiary">
        <div className="truncate font-mono text-[10px]">
          {session.model ? (
            <span title={session.model}>{session.model}</span>
          ) : (
            <span>seq: {session.lastSeq}</span>
          )}
        </div>

        {/* 二次确认删除区域 */}
        {isConfirmingDelete ? (
          <div
            data-testid="delete-confirm-box"
            className="flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-[10px] text-status-error font-medium">确认删除？</span>
            <button
              type="button"
              data-testid="confirm-delete-btn"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="rounded bg-status-error px-1.5 py-0.5 text-[10px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {isDeleting ? '...' : '确定'}
            </button>
            <button
              type="button"
              data-testid="cancel-delete-btn"
              onClick={handleCancelDelete}
              className="rounded bg-bg-panel px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-text-primary"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-testid="delete-session-btn"
            onClick={handleDeleteTrigger}
            className="rounded p-0.5 text-text-tertiary opacity-0 transition-opacity hover:bg-bg-panel hover:text-status-error group-hover:opacity-100"
            title="删除会话"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
