import React, { useEffect, useRef, useState } from 'react';
import type { Account, AccountIsolation, WhoAmI } from '@agy-studio/contracts';
import { useRouter } from '../../router';
import { useAccountStore } from '../../stores/account.store';

export interface AccountMenuProps {
  /** 显式提供账号列表与 whoami，用于测试或展示 */
  accounts?: Account[];
  whoami?: WhoAmI | null;
  className?: string;
  isOpen?: boolean;
  onToggle?: () => void;
}

export function AccountMenu({
  accounts: propAccounts,
  whoami: propWhoami,
  className = '',
  isOpen: controlledIsOpen,
  onToggle,
}: AccountMenuProps) {
  const isServer = typeof window === 'undefined';
  const storeState = useAccountStore();
  const currentStore = isServer ? useAccountStore.getState() : storeState;

  const accounts = propAccounts !== undefined ? propAccounts : currentStore.accounts;
  const whoami = propWhoami !== undefined ? propWhoami : currentStore.whoami;
  const storeSwitchAccount = currentStore.switchAccount;

  const { navigate } = useRouter();

  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : uncontrolledOpen;

  const [switchingName, setSwitchingName] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部和 ESC 键关闭
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        if (onToggle) {
          onToggle();
        } else {
          setUncontrolledOpen(false);
        }
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onToggle) {
          onToggle();
        } else {
          setUncontrolledOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onToggle]);

  const handleToggle = () => {
    setErrorMessage(null);
    if (onToggle) {
      onToggle();
    } else {
      setUncontrolledOpen((prev) => !prev);
    }
  };

  // 当前默认/激活账号
  const activeAccount = accounts.find((a) => a.active);
  const currentAccountName = whoami?.activeProfile || activeAccount?.name || 'default';
  const hasCredential = whoami?.credentialPresent ?? (accounts.length > 0);

  // 当前隔离模式
  const isolation: AccountIsolation =
    whoami?.isolation || activeAccount?.isolation || 'credential_snapshot';

  const isIsolatedHome = isolation === 'isolated_home';

  const handleSwitch = async (accountName: string) => {
    if (switchingName) return;
    setSwitchingName(accountName);
    setErrorMessage(null);

    try {
      await storeSwitchAccount(accountName);
      // 成功后关闭菜单或保持打开
    } catch (err: unknown) {
      const anyErr = err as { code?: string; message?: string; details?: { code?: string } };
      const code = anyErr?.code || anyErr?.details?.code;
      const msg = anyErr?.message || String(err);

      if (code === 'ACCOUNT_BUSY' || msg.includes('ACCOUNT_BUSY') || msg.toLowerCase().includes('busy')) {
        setErrorMessage('有任务正在运行，请等待任务结束后再切换');
      } else {
        setErrorMessage(msg || '切换账号失败');
      }
    } finally {
      setSwitchingName(null);
    }
  };

  const handleManageAccounts = () => {
    if (onToggle) {
      onToggle();
    } else {
      setUncontrolledOpen(false);
    }
    navigate('/accounts');
  };

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      {/* 顶栏触发器 */}
      <button
        type="button"
        onClick={handleToggle}
        className={`flex items-center gap-1.5 rounded-lg border bg-bg-surface px-2.5 py-1 text-text-secondary transition-colors select-none ${
          isOpen
            ? 'border-border-strong bg-bg-surface-hover shadow-sm'
            : 'border-border-default hover:border-border-strong hover:text-text-primary'
        }`}
        data-testid="account-dropdown"
        title="账号切换与管理"
      >
        <span
          className={`h-2 w-2 rounded-full ${
            hasCredential ? 'bg-status-success' : 'bg-status-warning'
          }`}
          data-testid="account-status-dot"
        />
        <span className="font-mono text-text-primary font-medium" data-testid="current-account-name">
          {currentAccountName}
        </span>
        <span className="text-[10px] text-text-tertiary">▾</span>
      </button>

      {/* 下拉菜单面板 */}
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-[320px] rounded-xl border border-border-strong bg-bg-surface text-text-primary shadow-2xl backdrop-blur-md overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100"
          data-testid="account-menu-popover"
        >
          {/* 顶部账号摘要与隔离模式 */}
          <div className="border-b border-border-default bg-bg-panel/70 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] text-text-tertiary">当前活跃账号</span>
                <div className="font-mono font-semibold text-sm text-text-primary">
                  {currentAccountName}
                </div>
              </div>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-medium border ${
                  isIsolatedHome
                    ? 'border-accent/30 bg-accent/15 text-accent'
                    : 'border-border-default bg-bg-panel text-text-secondary'
                }`}
                title={
                  isIsolatedHome
                    ? '每个账号独立 home 目录，可随时切换并并发执行'
                    : '单槽位凭据快照替换，切换需要所有任务已结束'
                }
                data-testid="isolation-badge"
              >
                {isIsolatedHome ? '独立主目录' : '单凭据快照'}
              </span>
            </div>

            {whoami?.email && (
              <div className="text-xs text-text-secondary mt-1 truncate">
                {whoami.email}
              </div>
            )}
          </div>

          {/* 切换繁忙或错误提示 */}
          {errorMessage && (
            <div
              className="flex items-center gap-2 border-b border-color-warning/30 bg-color-warning-subtle/50 px-4 py-2.5 text-xs text-color-warning"
              data-testid="account-busy-notice"
            >
              <span>⚠️</span>
              <span className="leading-snug">{errorMessage}</span>
            </div>
          )}

          {/* 账号列表 */}
          <div className="max-h-[300px] overflow-y-auto p-2 space-y-1">
            <div className="px-2 py-1 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
              {`全部已存账号 (${accounts.length})`}
            </div>

            {accounts.length === 0 ? (
              <div className="py-4 text-center text-xs text-text-tertiary">
                暂无已保存账号，点击管理添加
              </div>
            ) : (
              accounts.map((acc) => {
                const isActive = acc.active || acc.name === currentAccountName;
                const isBusy = acc.activeRuns > 0;
                const switchButtonLabel = isIsolatedHome ? '设为默认' : '切换';

                return (
                  <div
                    key={acc.name}
                    className={`flex items-center justify-between rounded-lg p-2 transition-colors ${
                      isActive
                        ? 'bg-bg-surface-active border border-border-default'
                        : 'hover:bg-bg-surface-hover'
                    }`}
                    data-testid={`account-row-${acc.name}`}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold text-text-primary truncate">
                          {acc.name}
                        </span>
                        {isActive && (
                          <span className="rounded bg-status-success/20 px-1.5 py-0.2 text-[9px] font-medium text-status-success">
                            当前
                          </span>
                        )}
                        <span className="rounded bg-bg-panel px-1 py-0.2 text-[9px] text-text-tertiary border border-border-subtle uppercase">
                          {acc.type}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-text-tertiary mt-0.5">
                        {acc.email && <span className="truncate max-w-[120px]">{acc.email}</span>}
                        <span className="flex items-center gap-1 font-mono">
                          {isBusy && (
                            <span className="h-1.5 w-1.5 rounded-full bg-status-warning animate-pulse" />
                          )}
                          <span>{`${acc.activeRuns} 运行中`}</span>
                        </span>
                      </div>
                    </div>

                    <div>
                      {isActive ? (
                        <span className="text-[11px] text-text-tertiary px-2 py-1">
                          使用中
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSwitch(acc.name)}
                          disabled={switchingName !== null}
                          className="rounded-md border border-border-default bg-bg-surface px-2.5 py-1 text-xs font-medium text-text-primary hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                          data-testid={`switch-account-${acc.name}`}
                        >
                          {switchingName === acc.name ? '切换中…' : switchButtonLabel}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 底部：管理账号 */}
          <div className="border-t border-border-default bg-bg-panel/70 p-2 flex items-center justify-between">
            <button
              type="button"
              onClick={handleManageAccounts}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-border-default bg-bg-surface py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary transition-colors"
              data-testid="manage-accounts-button"
            >
              <span>⚙️</span>
              <span>管理账号</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
