import React, { useState } from 'react';
import type {
  ISODateString,
  ToolCall,
  ToolKind,
  ToolStatus,
  TranscriptStep,
} from '@agy-studio/contracts';
import type { SubagentItem, ThinkingItem } from '../../domain/timeline.types';
import {
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LayersIcon,
  LoadingSpinner,
} from './icons';
import { MessageMarkdown } from './MessageMarkdown';
import { StatusDot } from './StatusDot';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCard } from './ToolCard';

export const MAX_VISIBLE_SUBAGENT_STEPS = 200;

export interface SubagentCardProps {
  item: SubagentItem;
  /** 可选注入已解析/加载的 steps，若未提供则使用 item.steps */
  steps?: TranscriptStep[];
  /** 是否展开（受控） */
  isExpanded?: boolean;
  /** 切换展开状态回调 */
  onToggleExpand?: () => void;
  /** 是否显示更早步骤或当前显示步数上限（受控，可传 boolean 或 number） */
  showEarlierSteps?: boolean | number;
  /** 切换显示更早步骤回调 */
  onToggleShowEarlierSteps?: () => void;
  /** 是否正在懒加载步骤 */
  isLoading?: boolean;
  /** 懒加载失败时的错误信息 */
  error?: string | null;
  /** 错误重试回调 */
  onRetry?: () => void;
  /** 自定义外层样式 */
  className?: string;
  /** 初始展开状态（非受控模式下生效） */
  defaultExpanded?: boolean;
}

const TOOL_KIND_MAP: Record<string, ToolKind> = {
  view_file: 'view_file',
  read_resource: 'view_file',
  read: 'view_file',
  read_file: 'view_file',
  write_to_file: 'write_file',
  write_file: 'write_file',
  write: 'write_file',
  replace_file_content: 'edit_file',
  multi_replace_file_content: 'edit_file',
  sed_file: 'edit_file',
  notebook_edit: 'edit_file',
  edit_file: 'edit_file',
  run_command: 'run_command',
  send_command_input: 'run_command',
  command_status: 'run_command',
  notebook_execution: 'run_command',
  bash: 'run_command',
  sh: 'run_command',
  grep_search: 'search',
  find_by_name: 'search',
  list_dir: 'search',
  search_web: 'search',
  search: 'search',
  browser_click_element: 'browser',
  browser_drag_pixel_to_pixel: 'browser',
  browser_get_dom: 'browser',
  browser_get_network_request: 'browser',
  browser_input: 'browser',
  browser_list_network_requests: 'browser',
  browser: 'browser',
};

export function inferToolKind(name: string): ToolKind {
  const norm = name.toLowerCase().trim();
  if (TOOL_KIND_MAP[norm]) return TOOL_KIND_MAP[norm];
  if (norm.startsWith('mcp_') || norm.includes('mcp')) return 'mcp';
  if (norm.includes('browser')) return 'browser';
  if (norm.includes('search') || norm.includes('grep') || norm.includes('find')) return 'search';
  if (norm.includes('file') || norm.includes('read') || norm.includes('write') || norm.includes('edit')) return 'view_file';
  if (norm.includes('cmd') || norm.includes('command') || norm.includes('bash') || norm.includes('shell')) return 'run_command';
  return 'other';
}

export function extractTarget(kind: ToolKind, args?: Record<string, unknown>): string | null {
  if (!args) return null;
  const targetKeys: Record<ToolKind, string[]> = {
    run_command: ['command', 'cmd', 'CommandLine', 'Command', 'Cmd'],
    view_file: ['path', 'filePath', 'file_path', 'AbsolutePath', 'absolute_path'],
    edit_file: ['path', 'filePath', 'file_path', 'AbsolutePath', 'absolute_path'],
    write_file: ['path', 'filePath', 'file_path', 'AbsolutePath', 'absolute_path'],
    search: ['query', 'Query', 'pattern', 'Pattern'],
    browser: ['url', 'Url', 'URL'],
    mcp: ['toolName', 'tool_name', 'tool'],
    subagent: ['role', 'Role', 'action'],
    other: ['target', 'path', 'query', 'url', 'command'],
  };
  const keys = targetKeys[kind] || ['target', 'path', 'query', 'url', 'command'];
  for (const k of keys) {
    const val = args[k];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

export function formatPromptSummary(prompt: string | null | undefined, maxChars = 80): string | null {
  if (!prompt) return null;
  const firstLine = prompt.trim().split('\n')[0].trim();
  if (!firstLine) return null;
  if (firstLine.length <= maxChars) return firstLine;
  return `${firstLine.slice(0, maxChars)}…`;
}

export function SubagentCard({
  item,
  steps: explicitSteps,
  isExpanded: controlledExpanded,
  onToggleExpand,
  showEarlierSteps: controlledShowEarlierSteps,
  onToggleShowEarlierSteps,
  isLoading = false,
  error = null,
  onRetry,
  className = '',
  defaultExpanded = false,
}: SubagentCardProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const [visibleLimit, setVisibleLimit] = useState(MAX_VISIBLE_SUBAGENT_STEPS);

  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : internalExpanded;

  const isEarlierControlled = controlledShowEarlierSteps !== undefined;
  const steps = explicitSteps ?? item.steps ?? [];
  const effectiveLimit = isEarlierControlled
    ? typeof controlledShowEarlierSteps === 'number'
      ? controlledShowEarlierSteps
      : controlledShowEarlierSteps
      ? steps.length
      : MAX_VISIBLE_SUBAGENT_STEPS
    : visibleLimit;

  const handleToggle = () => {
    if (isControlled) {
      onToggleExpand?.();
    } else {
      setInternalExpanded((prev) => !prev);
    }
  };

  const handleShowEarlier = () => {
    if (isEarlierControlled) {
      onToggleShowEarlierSteps?.();
    } else {
      // ★ B-10：分页扩容而非全量加载
      setVisibleLimit((prev) => prev + MAX_VISIBLE_SUBAGENT_STEPS);
    }
  };

  const promptSummary = formatPromptSummary(item.initialPrompt);

  const hasOverflow = steps.length > effectiveLimit;
  const displayedSteps = hasOverflow
    ? steps.slice(-effectiveLimit)
    : steps;

  return (
    <div
      className={`my-2 rounded-lg border border-border-default bg-bg-surface/40 transition-colors hover:border-border-strong ${className}`}
      data-testid="subagent-card"
      data-status={item.status}
      data-conversation-id={item.conversationId}
    >
      {/* 头部摘要栏 */}
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left text-text-secondary hover:bg-bg-surface-hover/40 transition-colors select-none focus:outline-none rounded-lg"
        aria-expanded={expanded}
        data-testid="subagent-toggle-btn"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span className="text-text-tertiary shrink-0">
            {expanded ? (
              <ChevronDownIcon className="w-3.5 h-3.5" />
            ) : (
              <ChevronRightIcon className="w-3.5 h-3.5" />
            )}
          </span>

          <span className="text-accent shrink-0">
            <LayersIcon className="w-4 h-4" />
          </span>

          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-text-primary text-xs tracking-tight">
                {item.role || 'subagent'}
              </span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-bg-surface-secondary text-text-tertiary border border-border-subtle">
                {item.typeName || 'subagent'}
              </span>
              {steps.length > 0 && (
                <span className="text-[11px] text-text-tertiary">
                  ({steps.length} {steps.length === 1 ? 'step' : 'steps'})
                </span>
              )}
            </div>

            {promptSummary && (
              <div
                className="mt-0.5 text-[11px] text-text-secondary/80 truncate font-mono"
                title={item.initialPrompt || undefined}
                data-testid="subagent-prompt-summary"
              >
                {promptSummary}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 pl-3 shrink-0">
          <StatusDot status={item.status} size="sm" />
        </div>
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div
          className="border-t border-border-subtle px-3 py-2 bg-bg-surface/20"
          data-testid="subagent-content"
        >
          {/* Loading 状态 */}
          {isLoading && (
            <div
              className="flex items-center gap-2 py-4 justify-center text-xs text-text-tertiary"
              data-testid="subagent-loading"
            >
              <LoadingSpinner className="w-4 h-4 text-accent" />
              <span>正在加载子 Agent 步骤...</span>
            </div>
          )}

          {/* 错误与重试 */}
          {!isLoading && error && (
            <div
              className="my-2 rounded border border-status-error/30 bg-status-error-subtle p-3 text-xs text-status-error-text flex items-center justify-between gap-2"
              data-testid="subagent-error"
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircleIcon className="w-4 h-4 shrink-0 text-status-error-text" />
                <span className="truncate">{error}</span>
              </div>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  data-testid="subagent-retry-btn"
                  className="px-2.5 py-1 shrink-0 rounded bg-status-error-subtle hover:bg-status-error/30 text-status-error-text font-medium transition-colors cursor-pointer text-xs"
                >
                  重试
                </button>
              )}
            </div>
          )}

          {/* 步骤列表 */}
          {!isLoading && !error && (
            <>
              {steps.length === 0 ? (
                <div
                  className="py-3 text-center text-xs text-text-tertiary"
                  data-testid="subagent-empty"
                >
                  暂无步骤记录
                </div>
              ) : (
                <div className="space-y-2">
                  {/* 超过 200 步的顶部按钮 */}
                  {hasOverflow && (
                    <div className="pt-1 pb-1 text-center border-b border-border-subtle mb-2">
                      <button
                        type="button"
                        onClick={handleShowEarlier}
                        data-testid="load-earlier-steps-btn"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-accent hover:text-accent-hover hover:bg-accent/10 rounded border border-accent/20 transition-colors"
                      >
                        显示更早的步骤 (Load earlier steps) ({steps.length - effectiveLimit} 步隐藏)
                      </button>
                    </div>
                  )}

                  {/* 渲染步骤 */}
                  <div className="space-y-2.5 pl-2 border-l border-border-subtle/80">
                    {displayedSteps.map((step) => {
                      const stepKey = `step-${step.stepIndex}`;

                      const thinkingItem: ThinkingItem | null = step.thinking
                        ? {
                            id: `th-${item.conversationId}-${step.stepIndex}`,
                            kind: 'thinking',
                            type: 'thinking',
                            blockId: `block-${item.conversationId}-${step.stepIndex}`,
                            source: 'transcript',
                            text: step.thinking,
                            startedAt: step.createdAt || item.createdAt,
                            endedAt: step.createdAt || null,
                            durationMs: null,
                            isComplete: step.status !== 'running',
                            runId: item.runId,
                          }
                        : null;

                      return (
                        <div
                          key={stepKey}
                          className="space-y-1.5"
                          data-testid="subagent-step"
                          data-step-index={step.stepIndex}
                        >
                          {/* 1. 思考过程 */}
                          {thinkingItem && (
                            <ThinkingBlock item={thinkingItem} />
                          )}

                          {/* 2. 工具调用 */}
                          {step.toolCalls && step.toolCalls.length > 0 && (
                            <div className="space-y-1.5">
                              {step.toolCalls.map((tc, tcIdx) => {
                                const toolKind = inferToolKind(tc.name);
                                const toolStatus: ToolStatus =
                                  step.status === 'error' || step.error
                                    ? 'failed'
                                    : step.status === 'running'
                                      ? 'running'
                                      : 'succeeded';
                                const toolCall: ToolCall = {
                                  toolCallId: `tc-${item.conversationId}-${step.stepIndex}-${tcIdx}`,
                                  name: tc.name,
                                  kind: toolKind,
                                  input: tc.args || {},
                                  target: extractTarget(toolKind, tc.args),
                                  output: null,
                                  error: null,
                                  status: toolStatus,
                                  fileChanges: [],
                                  startedAt: (step.createdAt || item.createdAt) as ISODateString,
                                  endedAt: (step.createdAt || item.createdAt) as ISODateString,
                                };

                                return (
                                  <ToolCard
                                    key={toolCall.toolCallId}
                                    tool={toolCall}
                                  />
                                );
                              })}
                            </div>
                          )}

                          {/* 3. 文本内容 */}
                          {step.content && (
                            <div className="text-xs text-text-primary px-1">
                              <MessageMarkdown content={step.content} />
                            </div>
                          )}

                          {/* 4. 错误信息 */}
                          {step.error && (
                            <div className="rounded border border-status-error/30 bg-status-error-subtle p-2 text-xs text-status-error-text">
                              {step.error}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
