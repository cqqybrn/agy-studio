import React, { useState } from 'react';
import type { Session } from '@agy-studio/contracts';
import { LoadingSpinner } from '../timeline/icons';
import { useAccountStore } from '../../stores/account.store';
import { useSessionStore } from '../../stores/session.store';
import { useUiStore } from '../../stores/ui.store';
import type { InboxIndicator } from './InboxList';

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

/** Spinner while running, blue dot when finished but unseen, nothing once seen. */
function IndicatorIcon({ indicator }: { indicator: InboxIndicator }) {
  return (
    <span
      data-testid="inbox-item-indicator"
      data-indicator={indicator}
      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
    >
      {indicator === 'running' && <LoadingSpinner className="h-3.5 w-3.5 text-accent" />}
      {indicator === 'unread' && <span className="h-2 w-2 rounded-full bg-accent" />}
    </span>
  );
}

export interface InboxItemProps {
  session: Session;
  indicator?: InboxIndicator;
  isActive?: boolean;
  isIsolatedHome?: boolean;
  onClick?: (session: Session) => void;
  onDelete?: (session: Session) => void;
}

export function InboxItem({
  session,
  indicator = 'none',
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
      className={`group relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors select-none ${
        isCurrentActive
          ? 'bg-bg-surface-active text-text-primary'
          : 'text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary'
      }`}
    >
      <IndicatorIcon indicator={indicator} />
      <span
        className={`min-w-0 flex-1 truncate ${indicator === 'unread' ? 'font-semibold text-text-primary' : ''}`}
        title={title}
      >
        {title}
      </span>

      {isIsolatedHome && session.accountName && (
        <span
          data-testid="inbox-item-account"
          className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] text-accent"
          title={`所属账号: ${session.accountName}`}
        >
          {session.accountName}
        </span>
      )}

      {isConfirmingDelete ? (
        <div
          data-testid="delete-confirm-box"
          className="flex shrink-0 items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            data-testid="confirm-delete-btn"
            onClick={handleConfirmDelete}
            disabled={isDeleting}
            className="rounded bg-status-error px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            {isDeleting ? '...' : '删除'}
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
        <>
          {relativeTime && (
            <span className="shrink-0 text-[10px] text-text-tertiary group-hover:hidden">{relativeTime}</span>
          )}
          <button
            type="button"
            data-testid="delete-session-btn"
            onClick={handleDeleteTrigger}
            className="hidden shrink-0 rounded p-0.5 text-text-tertiary hover:bg-bg-panel hover:text-status-error group-hover:block"
            title="删除会话"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
