import React, { useCallback, useEffect, useState } from 'react';
import type { Checkpoint, CheckpointDiff } from '@agy-studio/contracts';
import { getCheckpointDiff, getCheckpoints, rollbackCheckpoint } from '../../api/endpoints';
import { useSessionStore } from '../../stores/session.store';
import { DiffViewer } from '../common/DiffViewer';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  FileCodeIcon,
  LayersIcon,
  LoadingSpinner,
  XCircleIcon,
} from '../timeline/icons';

export const ROLLBACK_WARNING_TEXT =
  '工作区会恢复到这次运行开始前的状态，之后的所有修改（包括手动修改）都会被覆盖；系统会先自动保存一份回滚前的快照';

export function formatSnapshotTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

export interface ChangesViewProps {
  sessionId?: string | null;
  activeRunId?: string | null;
  checkpoints?: Checkpoint[];
  onCheckpointsLoaded?: (checkpoints: Checkpoint[]) => void;
  onRollbackSuccess?: (restoredFiles: number) => void;
  initialExpandedCheckpointId?: string | null;
  initialRollbackTarget?: Checkpoint | null;
  className?: string;
}

export function ChangesView({
  sessionId,
  activeRunId: propActiveRunId,
  checkpoints: propCheckpoints,
  onCheckpointsLoaded,
  onRollbackSuccess,
  initialExpandedCheckpointId = null,
  initialRollbackTarget = null,
  className = '',
}: ChangesViewProps) {
  // Read active run from session slot or prop
  const storeSlot = useSessionStore((s) => (sessionId ? s.slots[sessionId] : null));
  const sessionSlot =
    typeof window === 'undefined'
      ? (sessionId ? useSessionStore.getState().slots[sessionId] : null) ?? storeSlot
      : storeSlot;

  const effectiveActiveRunId =
    propActiveRunId !== undefined
      ? propActiveRunId
      : (sessionSlot?.activeRunId ?? sessionSlot?.pendingRunId ?? null);
  const isRunning = Boolean(effectiveActiveRunId);

  // Checkpoints list state
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>(propCheckpoints ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Expanded checkpoint for Diff viewing
  const [expandedCheckpointId, setExpandedCheckpointId] = useState<string | null>(
    initialExpandedCheckpointId,
  );

  // Cached diffs
  const [diffs, setDiffs] = useState<Record<string, CheckpointDiff>>({});
  const [diffLoadingMap, setDiffLoadingMap] = useState<Record<string, boolean>>(() => {
    if (initialExpandedCheckpointId) {
      return { [initialExpandedCheckpointId]: true };
    }
    return {};
  });
  const [diffErrorMap, setDiffErrorMap] = useState<Record<string, string | null>>({});

  // Rollback confirmation dialog state
  const [rollbackTarget, setRollbackTarget] = useState<Checkpoint | null>(
    initialRollbackTarget,
  );
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackSuccessMsg, setRollbackSuccessMsg] = useState<string | null>(null);
  const [rollbackErrorMsg, setRollbackErrorMsg] = useState<string | null>(null);

  // Fetch checkpoints list
  const fetchCheckpointsList = useCallback(
    async (targetSessionId: string) => {
      try {
        setLoading(true);
        setError(null);
        const list = await getCheckpoints(targetSessionId);
        setCheckpoints(list);
        onCheckpointsLoaded?.(list);
        return list;
      } catch (err: any) {
        const msg = err?.message || '获取检查点列表失败';
        setError(msg);
        setCheckpoints([]);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [onCheckpointsLoaded],
  );

  // Fetch diff for a specific checkpoint
  const fetchDiffForCheckpoint = useCallback(
    async (checkpointId: string) => {
      if (diffs[checkpointId] || diffLoadingMap[checkpointId]) return;

      try {
        setDiffLoadingMap((prev) => ({ ...prev, [checkpointId]: true }));
        setDiffErrorMap((prev) => ({ ...prev, [checkpointId]: null }));
        const diffData = await getCheckpointDiff(checkpointId);
        setDiffs((prev) => ({ ...prev, [checkpointId]: diffData }));
      } catch (err: any) {
        const msg = err?.message || '加载差异对比失败';
        setDiffErrorMap((prev) => ({ ...prev, [checkpointId]: msg }));
      } finally {
        setDiffLoadingMap((prev) => ({ ...prev, [checkpointId]: false }));
      }
    },
    [diffs, diffLoadingMap],
  );

  // Sync prop checkpoints
  useEffect(() => {
    if (propCheckpoints !== undefined) {
      setCheckpoints(propCheckpoints);
    }
  }, [propCheckpoints]);

  // Fetch on mount or sessionId change when no prop checkpoints are passed
  useEffect(() => {
    if (sessionId && propCheckpoints === undefined) {
      void fetchCheckpointsList(sessionId);
    }
  }, [sessionId, propCheckpoints, fetchCheckpointsList]);

  // If initialExpandedCheckpointId is specified, trigger its diff loading
  useEffect(() => {
    if (initialExpandedCheckpointId && !diffs[initialExpandedCheckpointId]) {
      void fetchDiffForCheckpoint(initialExpandedCheckpointId);
    }
  }, [initialExpandedCheckpointId, diffs, fetchDiffForCheckpoint]);

  // Toggle expand for a checkpoint
  const handleToggleCheckpoint = (checkpointId: string) => {
    if (expandedCheckpointId === checkpointId) {
      setExpandedCheckpointId(null);
    } else {
      setExpandedCheckpointId(checkpointId);
      if (!diffs[checkpointId]) {
        void fetchDiffForCheckpoint(checkpointId);
      }
    }
  };

  // Open rollback confirmation
  const handleOpenRollback = (checkpoint: Checkpoint) => {
    if (isRunning) return;
    setRollbackTarget(checkpoint);
    setRollbackErrorMsg(null);
  };

  // Cancel rollback
  const handleCancelRollback = () => {
    if (rollingBack) return;
    setRollbackTarget(null);
    setRollbackErrorMsg(null);
  };

  // Confirm and execute rollback
  const handleConfirmRollback = async () => {
    if (!rollbackTarget) return;

    // ★ B-2：二次校验运行状态
    if (isRunning) {
      setRollbackErrorMsg('当前会话正在运行中，无法回滚。请等待运行结束后再试。');
      return;
    }

    try {
      setRollingBack(true);
      setRollbackErrorMsg(null);
      const res = await rollbackCheckpoint(rollbackTarget.id);
      const restoredCount = res.restoredFiles ?? 0;
      setRollbackSuccessMsg(`回滚成功！已恢复 ${restoredCount} 个文件。`);
      setRollbackTarget(null);
      onRollbackSuccess?.(restoredCount);

      // Refresh list
      if (sessionId) {
        void fetchCheckpointsList(sessionId);
      }
    } catch (err: any) {
      const msg = err?.message || '回滚失败，请重试';
      setRollbackErrorMsg(msg);
    } finally {
      setRollingBack(false);
    }
  };

  return (
    <div
      className={`flex h-full flex-col bg-bg-panel text-xs ${className}`}
      data-testid="changes-view"
    >
      {/* 顶部状态提示栏：回滚成功提示 */}
      {rollbackSuccessMsg && (
        <div
          className="flex items-center justify-between border-b border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-300"
          data-testid="rollback-success-msg"
        >
          <div className="flex items-center gap-2">
            <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="font-medium">{rollbackSuccessMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setRollbackSuccessMsg(null)}
            className="rounded p-0.5 text-emerald-400 hover:bg-emerald-500/20"
            title="关闭提示"
          >
            ✕
          </button>
        </div>
      )}

      {/* 顶部全局错误提示 */}
      {(error || rollbackErrorMsg) && !rollbackTarget && (
        <div
          className="flex items-center justify-between border-b border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-300"
          data-testid="rollback-error-msg"
        >
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{error || rollbackErrorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setRollbackErrorMsg(null);
            }}
            className="rounded p-0.5 text-rose-400 hover:bg-rose-500/20"
            title="关闭提示"
          >
            ✕
          </button>
        </div>
      )}

      {/* 运行中警告栏 */}
      {isRunning && (
        <div
          className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300"
          data-testid="running-status-notice"
        >
          <LoadingSpinner className="h-3 w-3 animate-spin text-amber-400 shrink-0" />
          <span>当前会话正在运行中，回滚操作已锁定。</span>
        </div>
      )}

      {/* 主列表内容区 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3" data-testid="checkpoints-container">
        {loading && checkpoints.length === 0 ? (
          <div
            className="flex h-40 flex-col items-center justify-center text-text-tertiary"
            data-testid="checkpoints-loading"
          >
            <LoadingSpinner className="h-5 w-5 animate-spin text-accent" />
            <span className="mt-2 text-xs">正在加载检查点记录...</span>
          </div>
        ) : checkpoints.length === 0 ? (
          <div
            className="flex h-56 flex-col items-center justify-center p-6 text-center text-text-tertiary"
            data-testid="checkpoints-empty"
          >
            <div className="rounded-lg border border-dashed border-border-default p-6 w-full max-w-sm">
              <LayersIcon className="mx-auto mb-2 h-7 w-7 opacity-40 text-text-tertiary" />
              <p className="text-sm font-medium text-text-secondary">暂无检查点记录</p>
              <p className="mt-1 text-xs text-text-tertiary leading-relaxed">
                在任务运行执行过程中，系统会自动记录每个阶段的文件变更快照与历史检查点。
              </p>
            </div>
          </div>
        ) : (
          checkpoints.map((cp) => {
            const isExpanded = expandedCheckpointId === cp.id;
            const diffLoading = diffLoadingMap[cp.id] ?? false;
            const diffError = diffErrorMap[cp.id];
            const diffData = diffs[cp.id];
            const shortSha = cp.commitSha ? cp.commitSha.slice(0, 7) : 'head';
            const formattedTime = formatSnapshotTime(cp.createdAt);
            const filesCount = cp.filesChanged ?? 0;

            return (
              <div
                key={cp.id}
                data-testid={`checkpoint-item-${cp.id}`}
                className={`rounded-lg border transition-all ${
                  isExpanded
                    ? 'border-accent/40 bg-bg-surface/80 shadow-sm'
                    : 'border-border-default bg-bg-surface/40 hover:border-border-strong'
                }`}
              >
                {/* 检查点卡片 Header */}
                <div
                  onClick={() => handleToggleCheckpoint(cp.id)}
                  data-testid={`checkpoint-toggle-${cp.id}`}
                  className="flex cursor-pointer items-center justify-between p-3 select-none"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-text-tertiary shrink-0">
                      {isExpanded ? (
                        <ChevronDownIcon className="h-4 w-4 text-accent" />
                      ) : (
                        <ChevronRightIcon className="h-4 w-4" />
                      )}
                    </span>

                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-text-primary">
                          {shortSha}
                        </span>
                        <span className="rounded bg-bg-panel px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary border border-border-subtle">
                          {`Run: ${cp.runId}`}
                        </span>
                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent font-medium">
                          {`${filesCount} 个文件变更`}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
                        <ClockIcon className="h-3 w-3 shrink-0" />
                        <span>{formattedTime}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isRunning}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenRollback(cp);
                      }}
                      title={isRunning ? '运行中无法回滚' : '回滚到此检查点 (Rollback)'}
                      data-testid={`rollback-btn-${cp.id}`}
                      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                        isRunning
                          ? 'cursor-not-allowed border-border-subtle bg-bg-panel/50 text-text-tertiary opacity-50'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:border-amber-500/60 hover:bg-amber-500/20'
                      }`}
                    >
                      <span>{isRunning ? '运行中无法回滚' : '回滚到此检查点'}</span>
                    </button>
                  </div>
                </div>

                {/* 展开内容区：加载 DiffViewer */}
                {isExpanded && (
                  <div
                    className="border-t border-border-default/60 bg-bg-app p-2.5"
                    data-testid={`checkpoint-diff-container-${cp.id}`}
                  >
                    {diffLoading && (
                      <div
                        className="flex h-36 flex-col items-center justify-center text-text-tertiary"
                        data-testid="diff-loading"
                      >
                        <LoadingSpinner className="h-4 w-4 animate-spin text-accent" />
                        <span className="mt-2 text-xs">正在加载详细 Diff 差异...</span>
                      </div>
                    )}

                    {diffError && (
                      <div
                        className="rounded border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 flex items-center justify-between"
                        data-testid="diff-error"
                      >
                        <div className="flex items-center gap-2">
                          <AlertTriangleIcon className="h-4 w-4 text-rose-400 shrink-0" />
                          <span>{`加载差异失败: ${diffError}`}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void fetchDiffForCheckpoint(cp.id)}
                          className="rounded border border-rose-500/40 px-2 py-0.5 text-xs text-rose-200 hover:bg-rose-500/20"
                        >
                          重试
                        </button>
                      </div>
                    )}

                    {!diffLoading && !diffError && diffData && (
                      <DiffViewer diff={diffData} />
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 回滚二次确认对话框 (Rollback Confirmation Modal) */}
      {rollbackTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          data-testid="rollback-confirm-dialog"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-lg border border-border-strong bg-bg-panel shadow-2xl overflow-hidden">
            {/* 模态框顶部 */}
            <div className="flex items-center justify-between border-b border-border-default bg-bg-surface px-4 py-3">
              <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                <AlertTriangleIcon className="h-4 w-4" />
                <span>确认回滚到此检查点？</span>
              </div>
              <button
                type="button"
                disabled={rollingBack}
                onClick={handleCancelRollback}
                className="rounded p-1 text-text-tertiary hover:bg-bg-panel hover:text-text-primary"
                data-testid="close-rollback-dialog-btn"
              >
                ✕
              </button>
            </div>

            {/* 模态框主体内容 */}
            <div className="p-4 space-y-3.5">
              {/* 目标检查点信息 */}
              <div className="rounded border border-border-default bg-bg-surface/50 p-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-text-tertiary">目标提交 SHA:</span>
                  <span className="font-mono text-text-primary font-medium">
                    {rollbackTarget.commitSha.slice(0, 7)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-tertiary">快照记录时间:</span>
                  <span className="text-text-primary">
                    {formatSnapshotTime(rollbackTarget.createdAt)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-tertiary">关联运行 ID:</span>
                  <span className="font-mono text-text-secondary">
                    {rollbackTarget.runId}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-tertiary">受影响文件数:</span>
                  <span className="text-text-primary">
                    {`${rollbackTarget.filesChanged ?? 0} 个`}
                  </span>
                </div>
              </div>

              {/* 关键警示文案（严格符合说明要求） */}
              <div
                className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 leading-relaxed"
                data-testid="rollback-warning-text"
              >
                <div className="font-semibold text-amber-300 mb-1 flex items-center gap-1.5">
                  <AlertTriangleIcon className="h-3.5 w-3.5" />
                  <span>注意：</span>
                </div>
                <p>{ROLLBACK_WARNING_TEXT}</p>
              </div>

              {/* 回滚报错提示 */}
              {rollbackErrorMsg && (
                <div
                  className="rounded border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-300 flex items-start gap-2"
                  data-testid="rollback-error-msg"
                >
                  <XCircleIcon className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium">回滚失败：</p>
                    <p className="mt-0.5 opacity-90">{rollbackErrorMsg}</p>
                  </div>
                </div>
              )}
            </div>

            {/* 模态框底部按钮 */}
            <div className="flex items-center justify-end gap-2.5 border-t border-border-default bg-bg-surface px-4 py-3">
              <button
                type="button"
                disabled={rollingBack}
                onClick={handleCancelRollback}
                data-testid="cancel-rollback-btn"
                className="rounded-md border border-border-default bg-bg-panel px-3.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface hover:text-text-primary transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={rollingBack || isRunning}
                onClick={handleConfirmRollback}
                data-testid="confirm-rollback-btn"
                className="flex items-center gap-1.5 rounded-md bg-amber-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-amber-500 transition-colors shadow-sm disabled:opacity-50"
              >
                {rollingBack && <LoadingSpinner className="h-3.5 w-3.5 animate-spin" />}
                <span>{rollingBack ? '正在回滚...' : '确认回滚'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
