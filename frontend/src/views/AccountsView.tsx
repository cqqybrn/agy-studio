import React, { useEffect, useRef, useState } from 'react';
import type { Account, AccountIsolation, AccountLoginSession, WhoAmI } from '@agy-studio/contracts';
import {
  cancelLoginSession,
  getLoginSession,
  startLogin,
} from '../api/endpoints';
import { useAccountStore } from '../stores/account.store';

// 登录轮询间隔 (2 秒)
const LOGIN_POLL_INTERVAL_MS = 2000;
// 登录超时时间 (10 分钟 = 600 秒)
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export interface AccountsViewProps {
  accounts?: Account[];
  whoami?: WhoAmI | null;
  loading?: boolean;
}

export function AccountsView({
  accounts: propAccounts,
  whoami: propWhoami,
  loading: propLoading,
}: AccountsViewProps = {}) {
  const isServer = typeof window === 'undefined';
  const storeState = useAccountStore();
  const currentStore = isServer ? useAccountStore.getState() : storeState;

  const accounts = propAccounts !== undefined ? propAccounts : currentStore.accounts;
  const whoami = propWhoami !== undefined ? propWhoami : currentStore.whoami;
  const loading = propLoading !== undefined ? propLoading : currentStore.loading;
  const error = currentStore.error;
  const fetchAccounts = currentStore.fetchAccounts;
  const switchAccount = currentStore.switchAccount;
  const deleteAccount = currentStore.deleteAccount;

  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState<string | null>(null);

  // 初始加载账号列表
  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const activeAccount = accounts.find((a) => a.active);
  const currentIsolation: AccountIsolation =
    whoami?.isolation || activeAccount?.isolation || 'credential_snapshot';
  const isIsolatedHome = currentIsolation === 'isolated_home';

  const handleSwitch = async (name: string) => {
    if (isSwitching) return;
    setIsSwitching(name);
    setActionError(null);
    setSuccessNotice(null);

    try {
      await switchAccount(name);
      setSuccessNotice(`已成功切换至账号 "${name}"`);
    } catch (err: unknown) {
      const anyErr = err as { code?: string; message?: string; details?: { code?: string } };
      const code = anyErr?.code || anyErr?.details?.code;
      const msg = anyErr?.message || String(err);

      if (code === 'ACCOUNT_BUSY' || msg.includes('ACCOUNT_BUSY') || msg.toLowerCase().includes('busy')) {
        setActionError('有任务正在运行，请等待任务结束后再切换');
      } else {
        setActionError(`切换失败: ${msg}`);
      }
    } finally {
      setIsSwitching(null);
    }
  };

  const handleDelete = async (name: string) => {
    setActionError(null);
    setSuccessNotice(null);
    try {
      await deleteAccount(name);
      setSuccessNotice(`账号 "${name}" 已删除`);
      setDeleteConfirmTarget(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`删除失败: ${msg}`);
    }
  };

  return (
    <div
      className="flex h-full flex-col overflow-y-auto bg-bg-app p-6 text-text-primary"
      data-testid="accounts-view"
    >
      {/* 顶部标题区 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border-default pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-text-primary">
              账号管理 (AccountsView)
            </h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
                isIsolatedHome
                  ? 'border-accent/30 bg-accent/15 text-accent'
                  : 'border-border-default bg-bg-surface text-text-secondary'
              }`}
            >
              {isIsolatedHome ? '独立主目录模式' : '凭据快照切换模式'}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-tertiary">
            管理当前工作区与全局凭据快照，支持多账号安全隔离、单凭据槽位无缝切换与 Web 授权登录。
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => void fetchAccounts()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary transition-colors disabled:opacity-50"
            data-testid="refresh-accounts-btn"
          >
            <span className={loading ? 'animate-spin inline-block' : ''}>🔄</span>
            <span>刷新</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setIsLoginModalOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-accent bg-accent hover:bg-accent-hover px-3.5 py-1.5 text-xs font-semibold text-accent-foreground shadow-sm transition-colors"
            data-testid="login-new-account-btn"
          >
            <span>+</span>
            <span>登录新账号</span>
          </button>
        </div>
      </div>

      {/* 提示条 */}
      {actionError && (
        <div
          className="mt-4 flex items-center justify-between rounded-lg border border-color-error/30 bg-status-error-subtle/40 px-4 py-2.5 text-xs text-color-error animate-in fade-in"
          data-testid="accounts-action-error"
        >
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-text-tertiary hover:text-color-error ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {successNotice && (
        <div
          className="mt-4 flex items-center justify-between rounded-lg border border-status-success/30 bg-status-success-subtle/30 px-4 py-2.5 text-xs text-status-success animate-in fade-in"
          data-testid="accounts-action-success"
        >
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{successNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessNotice(null)}
            className="text-text-tertiary hover:text-status-success ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {error && !actionError && (
        <div className="mt-4 rounded-lg border border-color-error/30 bg-status-error-subtle/40 px-4 py-2.5 text-xs text-color-error">
          获取账号数据失败: {error}
        </div>
      )}

      {/* 隔离模式说明卡片 */}
      <div className="mt-4 rounded-xl border border-border-default bg-bg-surface/60 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent text-sm font-bold">
            ℹ️
          </div>
          <div className="text-xs space-y-1">
            <h4 className="font-semibold text-text-primary">
              {isIsolatedHome ? '独立主目录隔离 (isolated_home)' : '单凭据槽位快照隔离 (credential_snapshot)'}
            </h4>
            <p className="text-text-tertiary leading-relaxed">
              {isIsolatedHome
                ? '在此模式下，每个账号对应独立的本地 home 目录与会话凭据，支持不同账号同时并发执行任务，可随时自由设为默认。'
                : '受 agy 原生单一凭据槽位限制，切换账号会执行 DPAPI 本地快照热替换。切换时要求所有后台任务均已完成（不可处于运行中），否则会提示账号繁忙。'}
            </p>
          </div>
        </div>
      </div>

      {/* 账号表格 */}
      <div className="mt-6 flex-1 rounded-xl border border-border-default bg-bg-surface overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" data-testid="accounts-table">
            <thead>
              <tr className="border-b border-border-default bg-bg-panel/70 text-text-tertiary uppercase font-mono text-[11px]">
                <th className="px-4 py-3 font-medium">账号名称</th>
                <th className="px-4 py-3 font-medium">邮箱</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 font-medium">隔离模式</th>
                <th className="px-4 py-3 font-medium">运行任务</th>
                <th className="px-4 py-3 font-medium">备注</th>
                <th className="px-4 py-3 font-medium">保存时间</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-text-tertiary">
                    {loading ? '正在加载账号数据…' : '暂无账号凭据，请点击右上角“登录新账号”'}
                  </td>
                </tr>
              ) : (
                accounts.map((acc) => {
                  const isActive = acc.active || acc.name === whoami?.activeProfile;
                  const isBusy = acc.activeRuns > 0;
                  const switchLabel = isIsolatedHome ? '设为默认' : '切换';

                  return (
                    <tr
                      key={acc.name}
                      className={`transition-colors hover:bg-bg-surface-hover ${
                        isActive ? 'bg-bg-surface-active/40' : ''
                      }`}
                      data-testid={`account-item-${acc.name}`}
                    >
                      {/* 名称 */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-text-primary text-sm">
                            {acc.name}
                          </span>
                          {isActive && (
                            <span className="rounded-full bg-status-success/20 px-2 py-0.5 text-[10px] font-medium text-status-success border border-status-success/30">
                              当前激活
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 邮箱 */}
                      <td className="px-4 py-3 font-mono text-text-secondary">
                        {acc.email || <span className="text-text-tertiary">--</span>}
                      </td>

                      {/* 类型 */}
                      <td className="px-4 py-3">
                        <span className="rounded bg-bg-panel px-1.5 py-0.5 font-mono text-[10px] text-text-secondary border border-border-default uppercase">
                          {acc.type}
                        </span>
                      </td>

                      {/* 隔离模式 */}
                      <td className="px-4 py-3 font-mono text-text-tertiary text-[11px]">
                        {acc.isolation}
                      </td>

                      {/* 运行中任务 */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 font-mono">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              isBusy ? 'bg-status-warning animate-pulse' : 'bg-border-default'
                            }`}
                          />
                          <span className={isBusy ? 'text-status-warning font-semibold' : 'text-text-tertiary'}>
                            {acc.activeRuns}
                          </span>
                        </div>
                      </td>

                      {/* 备注 */}
                      <td className="px-4 py-3 text-text-tertiary max-w-[140px] truncate">
                        {acc.note || '--'}
                      </td>

                      {/* 保存时间 */}
                      <td className="px-4 py-3 font-mono text-text-tertiary text-[11px]">
                        {formatDateTime(acc.savedAt)}
                      </td>

                      {/* 操作 */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isActive ? (
                            <span className="text-[11px] text-text-tertiary font-medium">
                              默认使用中
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSwitch(acc.name)}
                              disabled={isSwitching !== null}
                              className="rounded-md border border-border-default bg-bg-surface px-2.5 py-1 text-xs font-medium text-text-secondary hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                              data-testid={`switch-btn-${acc.name}`}
                            >
                              {isSwitching === acc.name ? '切换中…' : switchLabel}
                            </button>
                          )}

                          {/* 删除操作 */}
                          {deleteConfirmTarget === acc.name ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleDelete(acc.name)}
                                className="rounded bg-status-error px-2 py-0.8 text-[11px] font-medium text-accent-foreground hover:bg-status-error/90 transition-colors"
                                data-testid={`confirm-delete-${acc.name}`}
                              >
                                确定
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmTarget(null)}
                                className="rounded border border-border-default px-1.5 py-0.8 text-[11px] text-text-tertiary hover:text-text-primary"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmTarget(acc.name)}
                              className="rounded px-2 py-1 text-text-tertiary hover:text-color-error transition-colors"
                              title="删除此账号快照"
                              data-testid={`delete-btn-${acc.name}`}
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 登录弹窗 */}
      {isLoginModalOpen && (
        <LoginModal
          onClose={() => setIsLoginModalOpen(false)}
          onSuccess={() => {
            void fetchAccounts();
          }}
        />
      )}
    </div>
  );
}

interface LoginModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function LoginModal({ onClose, onSuccess }: LoginModalProps) {
  const [saveAs, setSaveAs] = useState('');
  const [step, setStep] = useState<'input' | 'authorizing' | 'success' | 'failed' | 'timeout'>('input');
  const [session, setSession] = useState<AccountLoginSession | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearTimers = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, []);

  const handleStartLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = saveAs.trim();
    if (!trimmed) {
      setErrorMessage('请输入要保存的账号名称');
      return;
    }

    setErrorMessage(null);
    setIsStarting(true);

    try {
      const loginSession = await startLogin({ saveAs: trimmed });
      setSession(loginSession);
      setStep('authorizing');

      // 启动 10 分钟总超时定时器
      timeoutTimerRef.current = setTimeout(() => {
        clearTimers();
        setStep('timeout');
      }, LOGIN_TIMEOUT_MS);

      // 启动 2 秒轮询
      pollTimerRef.current = setInterval(async () => {
        try {
          const updated = await getLoginSession(loginSession.loginId);
          setSession(updated);

          if (updated.status === 'completed') {
            clearTimers();
            setStep('success');
            onSuccess();
          } else if (updated.status === 'failed') {
            clearTimers();
            setStep('failed');
            setErrorMessage(updated.error || '登录授权失败');
          } else if (updated.status === 'cancelled') {
            clearTimers();
            setStep('failed');
            setErrorMessage('登录流程已被取消');
          }
        } catch (pollErr: unknown) {
          // 容忍单次轮询网络抖动
          console.error('Polling login error:', pollErr);
        }
      }, LOGIN_POLL_INTERVAL_MS);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`发起登录失败: ${msg}`);
      setStep('input');
    } finally {
      setIsStarting(false);
    }
  };

  const handleCancelLogin = async () => {
    clearTimers();
    if (session?.loginId) {
      try {
        await cancelLoginSession(session.loginId);
      } catch (err) {
        console.error('Cancel login error:', err);
      }
    }
    onClose();
  };

  const handleOpenBrowser = () => {
    if (session?.authUrl) {
      window.open(session.authUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleCopyUrl = async () => {
    if (session?.authUrl) {
      try {
        await navigator.clipboard.writeText(session.authUrl);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } catch {
        // clipboard fallback
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      data-testid="login-modal-overlay"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border-strong bg-bg-surface p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        data-testid="login-modal"
      >
        <div className="flex items-center justify-between border-b border-border-default pb-3">
          <h3 className="font-semibold text-base text-text-primary">
            {step === 'input' && '登录新账号'}
            {step === 'authorizing' && '正在等待授权完成…'}
            {step === 'success' && '登录成功'}
            {(step === 'failed' || step === 'timeout') && '登录未完成'}
          </h3>
          <button
            type="button"
            onClick={step === 'authorizing' ? handleCancelLogin : onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-tertiary hover:bg-bg-surface-hover hover:text-text-primary"
            data-testid="close-login-modal"
          >
            ✕
          </button>
        </div>

        {/* 错误提示 */}
        {errorMessage && (
          <div
            className="mt-3 rounded-lg border border-color-error/30 bg-status-error-subtle/40 p-2.5 text-xs text-color-error"
            data-testid="login-error-message"
          >
            {errorMessage}
          </div>
        )}

        {/* 第一步：输入账号名称 */}
        {step === 'input' && (
          <form onSubmit={handleStartLogin} className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                账号别名 (用于在列表中识别此账号)
              </label>
              <input
                type="text"
                value={saveAs}
                onChange={(e) => setSaveAs(e.target.value)}
                placeholder="例如: personal, work-oauth, team-beta"
                autoFocus
                className="w-full rounded-lg border border-border-default bg-bg-app px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                data-testid="save-as-input"
              />
              <p className="mt-1 text-[11px] text-text-tertiary">
                登录完成后，凭据将被加密隔离保存在本地以此名称命名的快照中。
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border-default bg-bg-surface px-4 py-2 text-xs font-medium text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isStarting || !saveAs.trim()}
                className="flex items-center gap-1.5 rounded-lg border border-accent bg-accent hover:bg-accent-hover px-4 py-2 text-xs font-semibold text-accent-foreground transition-colors disabled:opacity-50"
                data-testid="start-login-submit"
              >
                {isStarting && <span className="animate-spin">🔄</span>}
                <span>发起登录</span>
              </button>
            </div>
          </form>
        )}

        {/* 第二步：授权中 (轮询) */}
        {step === 'authorizing' && (
          <div className="mt-4 space-y-4" data-testid="authorizing-step">
            <div className="flex items-center gap-3 rounded-lg border border-border-default bg-bg-panel/70 p-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent animate-pulse font-bold text-sm">
                ⏳
              </span>
              <div className="text-xs">
                <div className="font-semibold text-text-primary">
                  请在浏览器中完成登录，或在弹出的终端窗口中完成授权
                </div>
                <div className="text-text-tertiary mt-0.5">
                  系统每 2 秒检测一次授权结果（最多等待 10 分钟）
                </div>
              </div>
            </div>

            {session?.authUrl ? (
              <div className="space-y-2">
                <div className="text-xs font-medium text-text-secondary">
                  授权链接 (Auth URL):
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={session.authUrl}
                    className="flex-1 rounded-lg border border-border-default bg-bg-app px-2.5 py-1.5 font-mono text-[11px] text-text-secondary truncate focus:outline-none"
                    data-testid="auth-url-input"
                  />
                  <button
                    type="button"
                    onClick={handleCopyUrl}
                    className="rounded-lg border border-border-default bg-bg-surface px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap"
                    data-testid="copy-auth-url-btn"
                  >
                    {copySuccess ? '已复制' : '复制'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleOpenBrowser}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-accent bg-accent/15 hover:bg-accent/25 text-accent py-2 text-xs font-medium transition-colors"
                  data-testid="open-browser-btn"
                >
                  <span>🌐</span>
                  <span>在浏览器打开授权页面</span>
                </button>
              </div>
            ) : (
              <div className="py-2 text-center text-xs text-text-tertiary font-mono">
                正在等待后端初始化登录终端…
              </div>
            )}

            <div className="flex items-center justify-between border-t border-border-default pt-3">
              <span className="text-[11px] text-text-tertiary">
                账号别名: <strong className="font-mono text-text-secondary">{saveAs}</strong>
              </span>

              <button
                type="button"
                onClick={handleCancelLogin}
                className="rounded-lg border border-border-default bg-bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-color-error hover:border-color-error/50 transition-colors"
                data-testid="cancel-login-btn"
              >
                取消登录
              </button>
            </div>
          </div>
        )}

        {/* 成功状态 */}
        {step === 'success' && (
          <div className="mt-4 space-y-4 text-center py-2" data-testid="login-success-step">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-status-success/20 text-status-success text-2xl font-bold">
              ✓
            </div>
            <div>
              <h4 className="text-sm font-semibold text-text-primary">
                账号登录成功！
              </h4>
              <p className="text-xs text-text-tertiary mt-1">
                账号已成功加密并保存为 <strong className="font-mono text-text-primary">{saveAs}</strong>。
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-lg border border-accent bg-accent py-2 text-xs font-semibold text-accent-foreground hover:bg-accent-hover transition-colors"
                data-testid="login-complete-btn"
              >
                完成
              </button>
            </div>
          </div>
        )}

        {/* 失败或超时状态 */}
        {(step === 'failed' || step === 'timeout') && (
          <div className="mt-4 space-y-4 text-center py-2" data-testid="login-failed-step">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-status-error/20 text-color-error text-2xl font-bold">
              ✕
            </div>
            <div>
              <h4 className="text-sm font-semibold text-text-primary">
                {step === 'timeout' ? '登录超时' : '登录未完成'}
              </h4>
              <p className="text-xs text-text-tertiary mt-1">
                {step === 'timeout'
                  ? '等待授权已超过 10 分钟未见回调，流程已自动终止，请重新尝试。'
                  : errorMessage || '登录已被中断或认证服务出错。'}
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border-default bg-bg-surface px-4 py-2 text-xs text-text-secondary hover:text-text-primary"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setStep('input');
                }}
                className="rounded-lg border border-accent bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:bg-accent-hover"
                data-testid="login-retry-btn"
              >
                重新登录
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDateTime(isoString: string): string {
  if (!isoString) return '--';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
      d.getMinutes(),
    ).padStart(2, '0')}`;
  } catch {
    return isoString;
  }
}
