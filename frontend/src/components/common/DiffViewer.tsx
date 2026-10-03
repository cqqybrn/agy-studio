import React, { useMemo, useState } from 'react';
import type { CheckpointDiff, CheckpointFileDiff } from '@agy-studio/contracts';
import { ChevronDownIcon, ChevronRightIcon, FileCodeIcon } from '../timeline/icons';

export interface DiffLine {
  type: 'add' | 'del' | 'normal' | 'hunk' | 'meta';
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
}

export interface ParsedFileDiff {
  path: string;
  changeType: 'created' | 'modified' | 'deleted';
  patch: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
  isLarge: boolean;
}

export const LARGE_FILE_LINE_THRESHOLD = 300;

/**
 * Parses unified diff patch text into structured line tokens with line numbers and change counts.
 */
export function parseUnifiedDiff(
  patch: string,
  largeThreshold = LARGE_FILE_LINE_THRESHOLD,
): {
  lines: DiffLine[];
  additions: number;
  deletions: number;
  isLarge: boolean;
} {
  if (!patch || !patch.trim()) {
    return { lines: [], additions: 0, deletions: 0, isLarge: false };
  }

  const rawLines = patch.split(/\r?\n/);
  const lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;

  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of rawLines) {
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)?$/);
    if (hunkMatch) {
      inHunk = true;
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      lines.push({
        type: 'hunk',
        oldLineNumber: null,
        newLineNumber: null,
        content: line,
      });
      continue;
    }

    if (inHunk) {
      // ★ B-3：Hunk 内部不需要过滤 +++ / ---，文件头只出现在 inHunk=false 的阶段
      if (line.startsWith('+')) {
        additions++;
        lines.push({
          type: 'add',
          oldLineNumber: null,
          newLineNumber: newLine++,
          content: line,
        });
      } else if (line.startsWith('-')) {
        deletions++;
        lines.push({
          type: 'del',
          oldLineNumber: oldLine++,
          newLineNumber: null,
          content: line,
        });
      } else if (line.startsWith('\\')) {
        lines.push({
          type: 'meta',
          oldLineNumber: null,
          newLineNumber: null,
          content: line,
        });
      } else {
        lines.push({
          type: 'normal',
          oldLineNumber: oldLine++,
          newLineNumber: newLine++,
          content: line,
        });
      }
    } else {
      lines.push({
        type: 'meta',
        oldLineNumber: null,
        newLineNumber: null,
        content: line,
      });
    }
  }

  const isLarge = lines.length > largeThreshold || additions + deletions > largeThreshold;

  return {
    lines,
    additions,
    deletions,
    isLarge,
  };
}

export interface DiffViewerProps {
  diff?: CheckpointDiff | CheckpointFileDiff[] | null;
  files?: CheckpointFileDiff[];
  selectedFilePath?: string | null;
  onSelectFile?: (path: string) => void;
  defaultExpandedMap?: Record<string, boolean>;
  largeThreshold?: number;
  className?: string;
}

export function DiffViewer({
  diff,
  files: propFiles,
  selectedFilePath,
  onSelectFile,
  defaultExpandedMap,
  largeThreshold = LARGE_FILE_LINE_THRESHOLD,
  className = '',
}: DiffViewerProps) {
  // Normalize file diff list
  const rawFiles: CheckpointFileDiff[] = useMemo(() => {
    if (propFiles) return propFiles;
    if (!diff) return [];
    if (Array.isArray(diff)) return diff;
    return diff.files ?? [];
  }, [diff, propFiles]);

  // Parse all files
  const parsedFiles: ParsedFileDiff[] = useMemo(() => {
    return rawFiles.map((file) => {
      const parsed = parseUnifiedDiff(file.patch, largeThreshold);
      return {
        path: file.path,
        changeType: file.changeType,
        patch: file.patch,
        lines: parsed.lines,
        additions: parsed.additions,
        deletions: parsed.deletions,
        isLarge: parsed.isLarge,
      };
    });
  }, [rawFiles, largeThreshold]);

  // Manage per-file collapsed/expanded state.
  // Large files (> 300 lines) are collapsed by default.
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const f of parsedFiles) {
      if (defaultExpandedMap && f.path in defaultExpandedMap) {
        initial[f.path] = defaultExpandedMap[f.path];
      } else {
        // Large files default to collapsed; regular files default to expanded
        initial[f.path] = !f.isLarge;
      }
    }
    return initial;
  });

  const [activeFile, setActiveFile] = useState<string | null>(
    selectedFilePath ?? parsedFiles[0]?.path ?? null,
  );

  const totalAdditions = useMemo(
    () => parsedFiles.reduce((sum, f) => sum + f.additions, 0),
    [parsedFiles],
  );
  const totalDeletions = useMemo(
    () => parsedFiles.reduce((sum, f) => sum + f.deletions, 0),
    [parsedFiles],
  );

  // Check if all are expanded
  const allExpanded = useMemo(() => {
    if (parsedFiles.length === 0) return false;
    return parsedFiles.every((f) => expandedMap[f.path] === true);
  }, [parsedFiles, expandedMap]);

  const toggleAllExpanded = () => {
    const nextState = !allExpanded;
    const nextMap: Record<string, boolean> = {};
    for (const f of parsedFiles) {
      nextMap[f.path] = nextState;
    }
    setExpandedMap(nextMap);
  };

  const toggleFile = (path: string) => {
    setExpandedMap((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  const expandFile = (path: string) => {
    setExpandedMap((prev) => ({
      ...prev,
      [path]: true,
    }));
  };

  const handleSelectFile = (path: string) => {
    setActiveFile(path);
    onSelectFile?.(path);
    // If collapsed, expand it on selection
    expandFile(path);
    // Smooth scroll to target file element if in browser
    if (typeof document !== 'undefined') {
      const el = document.getElementById(`diff-file-${encodeURIComponent(path)}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (parsedFiles.length === 0) {
    return (
      <div
        className={`flex h-48 flex-col items-center justify-center p-6 text-center text-text-tertiary ${className}`}
        data-testid="diff-empty"
      >
        <FileCodeIcon className="mb-2 h-8 w-8 opacity-40" />
        <p className="text-sm font-medium text-text-secondary">暂无文件改动</p>
        <p className="mt-1 text-xs">该检查点未包含任何受版本管理的文件变更</p>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-md border border-border-default bg-bg-app ${className}`}
      data-testid="diff-viewer"
    >
      {/* 顶部总览栏 */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-default bg-bg-surface px-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text-primary">
            {`${parsedFiles.length} 个文件变更`}
          </span>
          <div className="flex items-center gap-1 font-mono text-[11px]">
            {totalAdditions > 0 && (
              <span className="rounded bg-status-success-subtle px-1.5 py-0.5 font-medium text-status-success-text">
                {`+${totalAdditions}`}
              </span>
            )}
            {totalDeletions > 0 && (
              <span className="rounded bg-status-error-subtle px-1.5 py-0.5 font-medium text-status-error-text">
                {`-${totalDeletions}`}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleAllExpanded}
            data-testid="expand-all-btn"
            className="rounded border border-border-default bg-bg-panel px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-surface hover:text-text-primary transition-colors"
          >
            {allExpanded ? '折叠全部 (Collapse all)' : '展开全部 (Expand all)'}
          </button>
        </div>
      </div>

      {/* 主体区：左侧文件列表侧边栏 + 右侧 Diff 详情 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左侧侧边栏 */}
        <aside
          className="w-56 shrink-0 border-r border-border-default bg-bg-panel flex flex-col overflow-y-auto"
          data-testid="diff-sidebar"
        >
          <div className="p-2 text-[11px] font-medium text-text-tertiary uppercase tracking-wider border-b border-border-subtle">
            {`变更文件 (${parsedFiles.length})`}
          </div>
          <div className="flex flex-col py-1">
            {parsedFiles.map((file) => {
              const isSelected = activeFile === file.path;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => handleSelectFile(file.path)}
                  data-testid={`diff-sidebar-item-${file.path}`}
                  className={`flex items-center justify-between px-2.5 py-1.5 text-left text-xs transition-colors ${
                    isSelected
                      ? 'bg-accent/15 text-accent font-medium'
                      : 'text-text-secondary hover:bg-bg-surface hover:text-text-primary'
                  }`}
                  title={file.path}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`inline-block px-1 rounded text-[10px] font-mono uppercase font-semibold shrink-0 ${
                        file.changeType === 'created'
                          ? 'bg-status-success-subtle text-status-success-text'
                          : file.changeType === 'deleted'
                          ? 'bg-status-error-subtle text-status-error-text'
                          : 'bg-status-warning-subtle text-status-warning-text'
                      }`}
                    >
                      {file.changeType === 'created'
                        ? 'A'
                        : file.changeType === 'deleted'
                        ? 'D'
                        : 'M'}
                    </span>
                    <span className="truncate font-mono text-[11px]">{file.path}</span>
                  </div>

                  <div className="flex items-center gap-1 font-mono text-[10px] shrink-0 pl-1">
                    {file.additions > 0 && (
                      <span className="text-status-success-text">{`+${file.additions}`}</span>
                    )}
                    {file.deletions > 0 && (
                      <span className="text-status-error-text">{`-${file.deletions}`}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* 右侧主 Diff 视图 */}
        <main
          className="flex-1 overflow-y-auto bg-bg-app p-3 space-y-4"
          data-testid="diff-main-view"
        >
          {parsedFiles.map((file) => {
            const isExpanded = expandedMap[file.path] ?? !file.isLarge;

            return (
              <section
                key={file.path}
                id={`diff-file-${encodeURIComponent(file.path)}`}
                data-testid={`diff-file-${file.path}`}
                className="rounded-md border border-border-default bg-bg-code overflow-hidden shadow-sm"
              >
                {/* 文件标题栏 */}
                <div className="flex items-center justify-between border-b border-border-default bg-bg-surface px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleFile(file.path)}
                      aria-expanded={isExpanded}
                      data-testid={`toggle-file-${file.path}`}
                      className="rounded p-0.5 text-text-tertiary hover:bg-bg-surface-hover hover:text-text-primary"
                    >
                      {isExpanded ? (
                        <ChevronDownIcon className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRightIcon className="h-3.5 w-3.5" />
                      )}
                    </button>

                    <FileCodeIcon className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
                    <span
                      className="font-mono font-medium text-text-primary truncate"
                      title={file.path}
                    >
                      {file.path}
                    </span>

                    <span
                      className={`rounded px-1.5 py-0.2 text-[10px] font-mono uppercase font-semibold ${
                        file.changeType === 'created'
                          ? 'bg-status-success-subtle text-status-success-text'
                          : file.changeType === 'deleted'
                          ? 'bg-status-error-subtle text-status-error-text'
                          : 'bg-status-warning-subtle text-status-warning-text'
                      }`}
                    >
                      {file.changeType}
                    </span>

                    {file.isLarge && (
                      <span
                        className="rounded border border-status-warning/30 bg-status-warning-subtle px-1.5 py-0.2 text-[10px] text-status-warning-text"
                        data-testid={`large-file-badge-${file.path}`}
                      >
                        {`大文件 (${file.lines.length} 行)`}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 font-mono text-[11px]">
                      {file.additions > 0 && (
                        <span className="text-status-success-text">{`+${file.additions}`}</span>
                      )}
                      {file.deletions > 0 && (
                        <span className="text-status-error-text">{`-${file.deletions}`}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 文件 Diff 内容 */}
                {isExpanded ? (
                  <div
                    className="overflow-x-auto font-mono text-xs leading-relaxed"
                    data-testid={`diff-lines-${file.path}`}
                  >
                    {file.lines.length === 0 ? (
                      <div className="p-3 text-center text-text-tertiary italic">
                        无行级别差异或为空文件
                      </div>
                    ) : (
                      <table className="w-full border-collapse">
                        <tbody>
                          {file.lines.map((line, idx) => {
                            if (line.type === 'hunk') {
                              return (
                                <tr
                                  key={idx}
                                  className="bg-accent/10 text-accent font-semibold"
                                  data-testid="diff-line-hunk"
                                >
                                  <td
                                    colSpan={3}
                                    className="px-3 py-1 select-none text-[11px]"
                                  >
                                    {line.content}
                                  </td>
                                </tr>
                              );
                            }

                            if (line.type === 'meta') {
                              return (
                                <tr
                                  key={idx}
                                  className="bg-bg-surface/40 text-text-tertiary text-[11px]"
                                  data-testid="diff-line-meta"
                                >
                                  <td
                                    colSpan={3}
                                    className="px-3 py-0.5 select-none"
                                  >
                                    {line.content}
                                  </td>
                                </tr>
                              );
                            }

                            const isAdd = line.type === 'add';
                            const isDel = line.type === 'del';

                            const rowBg = isAdd
                              ? 'bg-status-success-subtle text-status-success-text border-l-2 border-status-success'
                              : isDel
                              ? 'bg-status-error-subtle text-status-error-text border-l-2 border-status-error'
                              : 'text-text-secondary hover:bg-bg-surface/30';

                            return (
                              <tr
                                key={idx}
                                className={`${rowBg} transition-colors`}
                                data-testid={
                                  isAdd
                                    ? 'diff-line-add'
                                    : isDel
                                    ? 'diff-line-del'
                                    : 'diff-line-normal'
                                }
                              >
                                {/* 原文件行号 */}
                                <td
                                  className="w-12 select-none px-2 text-right font-mono text-[11px] text-text-tertiary opacity-70 border-r border-border-subtle/40"
                                  data-testid="old-line-number"
                                >
                                  {line.oldLineNumber ?? ''}
                                </td>

                                {/* 新文件行号 */}
                                <td
                                  className="w-12 select-none px-2 text-right font-mono text-[11px] text-text-tertiary opacity-70 border-r border-border-subtle/40"
                                  data-testid="new-line-number"
                                >
                                  {line.newLineNumber ?? ''}
                                </td>

                                {/* 代码内容 (包含前缀 +/-) */}
                                <td
                                  className="px-2 py-0.5 whitespace-pre font-mono"
                                  data-testid="diff-line-content"
                                >
                                  <span className="inline-block w-4 select-none font-bold opacity-80">
                                    {isAdd ? '+' : isDel ? '-' : ' '}
                                  </span>
                                  {line.content.startsWith('+') || line.content.startsWith('-')
                                    ? line.content.slice(1)
                                    : line.content.startsWith(' ')
                                    ? line.content.slice(1)
                                    : line.content}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                ) : (
                  /* 大文件折叠占位条 */
                  <div
                    className="flex flex-col items-center justify-center p-6 text-center bg-bg-panel/40"
                    data-testid={`diff-collapsed-notice-${file.path}`}
                  >
                    <p className="text-xs text-text-secondary">
                      {file.isLarge
                        ? `此文件包含超过 ${largeThreshold} 行修改（大文件），已默认折叠以优化性能。`
                        : '文件内容已折叠。'}
                    </p>
                    <button
                      type="button"
                      onClick={() => expandFile(file.path)}
                      data-testid={`expand-single-${file.path}`}
                      className="mt-2.5 rounded border border-border-default bg-bg-surface px-3 py-1 text-xs font-medium text-accent hover:bg-bg-surface-hover hover:border-accent/40 transition-colors"
                    >
                      展开内容 (Expand)
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </main>
      </div>
    </div>
  );
}
