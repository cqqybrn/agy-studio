import type {
  AssistantMessageItem,
  ErrorItem,
  RunDividerItem,
  StalledNoticeItem,
  SubagentItem,
  ThinkingItem,
  TimelineItem,
  ToolItem,
  UserMessageItem,
} from './timeline.types';
import { toolCategory, type ToolCategory } from './toolLabels';

/**
 * Display projection of the timeline (docs/ARCHITECTURE.md §2.4).
 *
 * The reducer keeps one item per agy step; the view instead shows consecutive work
 * (tools, thinking, subagents) as a collapsible "Worked for Xs" block between the
 * messages, and inside a block counts adjacent tools of the same category together.
 * Pure and deterministic so it can be memoised on `items`.
 */

export type WorkedChild =
  | { kind: 'tool'; key: string; item: ToolItem }
  | { kind: 'tool_group'; key: string; category: ToolCategory; tools: ToolItem[] }
  | { kind: 'thinking'; key: string; item: ThinkingItem }
  | { kind: 'subagent'; key: string; item: SubagentItem };

export interface WorkedRow {
  kind: 'worked';
  key: string;
  runId: string | null;
  children: WorkedChild[];
  startedAt: string;
  /** Null while the block is still accumulating work. */
  endedAt: string | null;
  active: boolean;
  failed: boolean;
  showIdentity: boolean;
}

export type DisplayRow =
  | { kind: 'user_message'; key: string; item: UserMessageItem }
  | { kind: 'assistant_message'; key: string; item: AssistantMessageItem; showIdentity: boolean }
  | WorkedRow
  | { kind: 'run_divider'; key: string; item: RunDividerItem }
  | { kind: 'error'; key: string; item: ErrorItem }
  | { kind: 'stalled_notice'; key: string; item: StalledNoticeItem };

export interface BuildDisplayRowsOptions {
  activeRunId: string | null;
  thinkingHidden?: boolean;
}

type WorkEntry =
  | { kind: 'tool'; item: ToolItem }
  | { kind: 'thinking'; item: ThinkingItem }
  | { kind: 'subagent'; item: SubagentItem };

function flattenWork(item: TimelineItem, thinkingHidden: boolean): WorkEntry[] | null {
  switch (item.kind) {
    case 'tool':
      return [{ kind: 'tool', item }];
    case 'tool_group':
      return item.tools.map((tool) => ({ kind: 'tool' as const, item: tool }));
    case 'thinking':
      return thinkingHidden ? [] : [{ kind: 'thinking', item }];
    case 'subagent':
      return [{ kind: 'subagent', item }];
    default:
      return null;
  }
}

function entryKey(entry: WorkEntry): string {
  return entry.kind === 'tool' ? entry.item.toolCallId : entry.item.id;
}

function entryStart(entry: WorkEntry): string {
  switch (entry.kind) {
    case 'tool':
      return entry.item.tool.startedAt || entry.item.createdAt;
    case 'thinking':
      return entry.item.startedAt;
    case 'subagent':
      return entry.item.createdAt;
  }
}

function entryLastSeen(entry: WorkEntry): string {
  switch (entry.kind) {
    case 'tool':
      return entry.item.tool.endedAt ?? entry.item.updatedAt;
    case 'thinking':
      return entry.item.endedAt ?? entry.item.startedAt;
    case 'subagent':
      return entry.item.updatedAt;
  }
}

function itemTime(item: TimelineItem): string {
  switch (item.kind) {
    case 'user_message':
    case 'assistant_message':
      return item.createdAt;
    case 'run_divider':
    case 'error':
    case 'stalled_notice':
      return item.timestamp;
    default:
      return '';
  }
}

function maxIso(a: string, b: string): string {
  return Date.parse(b) > Date.parse(a) ? b : a;
}

function minIso(a: string, b: string): string {
  return Date.parse(b) < Date.parse(a) ? b : a;
}

/** Adjacent tools of the same category become one group; anything else breaks the run. */
export function groupWorkedChildren(entries: readonly WorkEntry[]): WorkedChild[] {
  const children: WorkedChild[] = [];
  let pending: ToolItem[] = [];
  let pendingCategory: ToolCategory | null = null;

  const flush = () => {
    if (pending.length === 1) {
      children.push({ kind: 'tool', key: pending[0].toolCallId, item: pending[0] });
    } else if (pending.length > 1 && pendingCategory) {
      children.push({
        kind: 'tool_group',
        key: `group-${pending[0].toolCallId}`,
        category: pendingCategory,
        tools: pending,
      });
    }
    pending = [];
    pendingCategory = null;
  };

  for (const entry of entries) {
    if (entry.kind === 'tool') {
      const category = toolCategory(entry.item.tool.kind);
      if (pendingCategory !== null && category !== pendingCategory) {
        flush();
      }
      pending.push(entry.item);
      pendingCategory = category;
      continue;
    }
    flush();
    children.push({ kind: entry.kind, key: entry.item.id, item: entry.item } as WorkedChild);
  }
  flush();
  return children;
}

export function buildDisplayRows(
  items: readonly TimelineItem[],
  options: BuildDisplayRowsOptions,
): DisplayRow[] {
  const thinkingHidden = options.thinkingHidden ?? false;
  const rows: DisplayRow[] = [];

  let work: WorkEntry[] = [];
  let workRunId: string | null = null;

  const identityShown = new Set<string>();
  let userTurn = 0;
  const takeIdentity = (runId: string | null): boolean => {
    const key = runId ?? `turn-${userTurn}`;
    if (identityShown.has(key)) return false;
    identityShown.add(key);
    return true;
  };

  const flushWork = (boundary: TimelineItem | null) => {
    if (work.length === 0) return;
    const entries = work;
    work = [];

    let startedAt = entryStart(entries[0]);
    let lastSeen = entryLastSeen(entries[0]);
    let failed = false;
    for (const entry of entries) {
      startedAt = minIso(startedAt, entryStart(entry));
      lastSeen = maxIso(lastSeen, entryLastSeen(entry));
      if (entry.kind === 'tool' && entry.item.tool.status === 'failed') failed = true;
      if (entry.kind === 'subagent' && entry.item.status === 'failed') failed = true;
    }

    const boundaryInRun = boundary !== null && boundary.runId === workRunId && itemTime(boundary) !== '';
    const isTail = boundary === null;
    const active = isTail && workRunId !== null && workRunId === options.activeRunId;

    let endedAt: string | null;
    if (boundaryInRun) {
      endedAt = maxIso(lastSeen, itemTime(boundary));
    } else if (active) {
      endedAt = null;
    } else {
      endedAt = lastSeen;
    }

    rows.push({
      kind: 'worked',
      key: `worked-${entryKey(entries[0])}`,
      runId: workRunId,
      children: groupWorkedChildren(entries),
      startedAt,
      endedAt,
      active,
      failed,
      showIdentity: takeIdentity(workRunId),
    });
  };

  items.forEach((item) => {
    const entries = flattenWork(item, thinkingHidden);
    if (entries !== null) {
      if (work.length > 0 && item.runId !== workRunId) {
        flushWork(null);
      }
      if (entries.length === 0) return;
      if (work.length === 0) {
        workRunId = item.runId;
      }
      work.push(...entries);
      return;
    }

    flushWork(item);

    switch (item.kind) {
      case 'user_message':
        userTurn += 1;
        rows.push({ kind: 'user_message', key: item.id, item });
        break;
      case 'assistant_message':
        rows.push({
          kind: 'assistant_message',
          key: item.id,
          item,
          showIdentity: takeIdentity(item.runId),
        });
        break;
      case 'run_divider':
        rows.push({ kind: 'run_divider', key: item.id, item });
        break;
      case 'error':
        rows.push({ kind: 'error', key: item.id, item });
        break;
      case 'stalled_notice':
        rows.push({ kind: 'stalled_notice', key: item.id, item });
        break;
    }
  });
  flushWork(null);

  return rows;
}

/** "42s", "1m", "1h 5m" — the coarse style used by the Worked header. */
export function formatWorkedDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
