import React, { useState } from 'react';
import type { Session } from '@agy-studio/contracts';
import { useAccountStore } from '../../stores/account.store';
import { useSessionStore } from '../../stores/session.store';
import { useWorkspaceStore } from '../../stores/workspace.store';
import { useIsIsolatedHome } from './InboxItem';

export interface NewSessionButtonProps {
  className?: string;
  isIsolatedHome?: boolean;
  onCreated?: (session: Session) => void;
}

export function NewSessionButton({
  className = '',
  isIsolatedHome: propIsIsolatedHome,
  onCreated,
}: NewSessionButtonProps) {
  const isIsolatedHome = useIsIsolatedHome(propIsIsolatedHome);
  const accounts = useAccountStore((s) => s.accounts);
  const whoami = useAccountStore((s) => s.whoami);
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getDefaultAccountName = (): string => {
    const activeAcc = accounts.find((a) => a.active);
    if (activeAcc) return activeAcc.name;
    if (whoami?.activeProfile) return whoami.activeProfile;
    if (accounts.length > 0) return accounts[0].name;
    return '';
  };

  const getWorkspaceId = (): string => {
    return currentWorkspace?.id || workspaces[0]?.id || 'default';
  };

  const doCreateSession = async (accountName?: string) => {
    setIsCreating(true);
    setError(null);
    try {
      const created = await useSessionStore.getState().createSession({
        workspaceId: getWorkspaceId(),
        accountName: accountName?.trim() ? accountName.trim() : undefined,
      });
      setIsAccountDialogOpen(false);
      onCreated?.(created);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsCreating(false);
    }
  };

  const handleClick = async () => {
    if (isIsolatedHome) {
      const defaultAcc = getDefaultAccountName();
      setSelectedAccount(defaultAcc);
      setError(null);
      setIsAccountDialogOpen(true);
    } else {
      await doCreateSession();
    }
  };

  const handleConfirmAccountSelect = async (e: React.FormEvent) => {
    e.preventDefault();
    await doCreateSession(selectedAccount);
  };

  return (
    <>
      <button
        type="button"
        data-testid="new-session-btn"
        onClick={handleClick}
        disabled={isCreating}
        className={`flex items-center justify-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground shadow-sm hover:bg-accent-hover disabled:opacity-50 transition-colors ${className}`}
      >
        <span>+</span>
        <span>{isCreating ? '创建中...' : '新建会话'}</span>
      </button>

      {/* isolated_home 模式下的账号选择弹窗 */}
      {isAccountDialogOpen && (
        <div
          data-testid="select-account-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 text-xs select-none"
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border-default bg-bg-panel p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border-default pb-3">
              <h3 className="text-sm font-semibold text-text-primary">
                新建会话 - 选择所属账号
              </h3>
              <button
                type="button"
                data-testid="cancel-create-session-x-btn"
                onClick={() => setIsAccountDialogOpen(false)}
                className="rounded p-1 text-text-tertiary hover:bg-bg-surface hover:text-text-primary transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmAccountSelect} className="mt-4 space-y-4">
              <div>
                <label className="block font-medium text-text-secondary">
                  选择运行账号
                </label>
                <select
                  data-testid="account-select"
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className="mt-1.5 w-full rounded border border-border-default bg-bg-surface px-3 py-2 text-text-primary focus:border-accent focus:outline-none"
                >
                  {accounts.length === 0 ? (
                    <option value="">(无已保存账号，使用默认)</option>
                  ) : (
                    accounts.map((acc) => (
                      <option key={acc.name} value={acc.name}>
                        {acc.name} {acc.active ? '(当前默认)' : ''}
                      </option>
                    ))
                  )}
                </select>
                <p className="mt-1 text-[11px] text-text-tertiary">
                  当前处于 isolated_home 模式，新会话将绑定至该独立账号目录。
                </p>
              </div>

              {error && (
                <div
                  data-testid="new-session-error"
                  className="rounded border border-status-error/30 bg-status-error/10 p-2 text-status-error"
                >
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-default">
                <button
                  type="button"
                  data-testid="cancel-create-session-btn"
                  onClick={() => setIsAccountDialogOpen(false)}
                  disabled={isCreating}
                  className="rounded border border-border-default bg-bg-surface px-3 py-1.5 text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  data-testid="confirm-create-session-btn"
                  disabled={isCreating}
                  className="rounded bg-accent px-4 py-1.5 font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-50 transition-colors"
                >
                  {isCreating ? '创建中...' : '确认创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
