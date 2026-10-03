import React, { useMemo } from 'react';
import { CheckIcon, LoadingSpinner } from '../timeline/icons';

export interface TaskItem {
  id: string;
  text: string;
  completed: boolean;
  level: number;
  section?: string;
}

export interface TaskStats {
  total: number;
  completed: number;
  percentage: number;
}

export interface ParsedTasks {
  items: TaskItem[];
  stats: TaskStats;
  sections: { title: string; items: TaskItem[] }[];
}

export function parseTaskList(markdown: string): ParsedTasks {
  if (!markdown) {
    return {
      items: [],
      stats: { total: 0, completed: 0, percentage: 0 },
      sections: [],
    };
  }

  const lines = markdown.split(/\r?\n/);
  const items: TaskItem[] = [];
  let currentSection = '任务清单';
  const sections: { title: string; items: TaskItem[] }[] = [];
  let currentSectionObj: { title: string; items: TaskItem[] } = {
    title: currentSection,
    items: [],
  };

  const taskRegex = /^(\s*)[-*]\s*\[([ xX])\]\s*(.*)$/;
  const headerRegex = /^(#{1,6})\s+(.*)$/;

  lines.forEach((line, index) => {
    const headerMatch = line.match(headerRegex);
    if (headerMatch) {
      currentSection = headerMatch[2].trim();
      if (currentSectionObj.items.length > 0) {
        sections.push(currentSectionObj);
      }
      currentSectionObj = { title: currentSection, items: [] };
      return;
    }

    const taskMatch = line.match(taskRegex);
    if (taskMatch) {
      // ★ B-6：标准化 Tab 为 2 个空格后再计算层级
      const indentStr = taskMatch[1].replace(/\t/g, '  ');
      const indent = indentStr.length;
      const level = Math.floor(indent / 2);
      const isCompleted = taskMatch[2].toLowerCase() === 'x';
      const text = taskMatch[3].trim();
      const item: TaskItem = {
        id: `task-${index}`,
        text,
        completed: isCompleted,
        level,
        section: currentSection,
      };
      items.push(item);
      currentSectionObj.items.push(item);
    }
  });

  if (currentSectionObj.items.length > 0) {
    sections.push(currentSectionObj);
  }

  const total = items.length;
  const completed = items.filter((i) => i.completed).length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    items,
    stats: { total, completed, percentage },
    sections,
  };
}

export interface TaskViewProps {
  content?: string;
  loading?: boolean;
  isHighlighted?: boolean;
  className?: string;
}

export function TaskView({
  content = '',
  loading = false,
  isHighlighted = false,
  className = '',
}: TaskViewProps) {
  const { items, stats, sections } = useMemo(() => parseTaskList(content), [content]);

  if (loading) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 text-text-tertiary">
        <LoadingSpinner className="h-5 w-5 animate-spin text-accent" />
        <span className="text-xs">加载任务清单中...</span>
      </div>
    );
  }

  if (!content.trim() && items.length === 0) {
    return (
      <div
        className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-border-default p-6 text-center text-text-tertiary"
        data-testid="task-empty-state"
      >
        <span className="text-sm">暂无任务清单内容</span>
        <span className="mt-1 text-xs text-text-tertiary">运行过程中将自动生成任务拆解</span>
      </div>
    );
  }

  const isAllCompleted = stats.total > 0 && stats.completed === stats.total;

  return (
    <div
      className={`flex flex-col gap-4 p-4 text-xs transition-colors duration-500 ${
        isHighlighted
          ? 'rounded-lg bg-status-warning-subtle ring-2 ring-status-warning/60'
          : ''
      } ${className}`}
      data-testid="task-view"
      data-highlighted={isHighlighted ? 'true' : 'false'}
    >
      {/* 顶部统计与进度条 */}
      <div className="rounded-lg border border-border-default bg-bg-surface p-3.5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary">任务完成度</span>
            {isHighlighted && (
              <span className="rounded bg-status-warning-subtle px-1.5 py-0.5 font-mono text-[10px] text-status-warning-text font-semibold animate-pulse">
                已刷新
              </span>
            )}
          </div>
          <span
            className="font-mono text-xs font-semibold text-text-secondary"
            data-testid="task-stats"
          >
            {`${stats.completed} / ${stats.total} Completed · ${stats.percentage}%`}
          </span>
        </div>

        {/* 进度条轨道 */}
        <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-bg-panel border border-border-default">
          <div
            className={`h-full transition-all duration-300 ${
              isAllCompleted ? 'bg-status-success' : 'bg-accent'
            }`}
            style={{ width: `${stats.percentage}%` }}
            data-testid="task-progress-bar"
          />
        </div>
      </div>

      {/* 任务列表展示 */}
      {items.length === 0 ? (
        <div className="rounded-md border border-border-default bg-bg-surface p-4 text-center text-text-tertiary">
          未解析到标准待办项（- [ ] 或 - [x]）
        </div>
      ) : (
        <div className="flex flex-col gap-4" data-testid="task-list">
          {sections.map((section, sIdx) => (
            <div key={`section-${sIdx}`} className="flex flex-col gap-1.5">
              {section.title && section.title !== '任务清单' && (
                <div className="mb-1 text-xs font-semibold text-text-secondary">
                  {section.title}
                </div>
              )}
              <div className="flex flex-col gap-1">
                {section.items.map((item) => (
                  <div
                    key={item.id}
                    style={{ paddingLeft: `${item.level * 16}px` }}
                    className={`group flex items-start gap-2 rounded-md px-2.5 py-1.5 transition-colors ${
                      item.completed
                        ? 'bg-bg-surface/40 hover:bg-bg-surface'
                        : 'bg-bg-surface hover:bg-bg-surface-hover'
                    }`}
                    data-testid={`task-item-${item.id}`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                        item.completed
                          ? 'border-status-success bg-status-success text-accent-foreground'
                          : 'border-border-strong bg-bg-panel text-transparent group-hover:border-accent'
                      }`}
                    >
                      <CheckIcon className="h-3 w-3" />
                    </span>
                    <span
                      className={`leading-relaxed break-words ${
                        item.completed
                          ? 'text-text-tertiary line-through decoration-border-strong'
                          : 'text-text-primary'
                      }`}
                    >
                      {item.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
