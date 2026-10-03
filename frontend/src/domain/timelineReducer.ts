import type {
  ISODateString,
  SessionEventEnvelope,
  SubagentStatus,
  ToolCall,
  ToolKind,
  TranscriptStep,
} from '@agy-studio/contracts';
import type {
  AssistantMessageItem,
  ErrorItem,
  RunDividerItem,
  StalledNoticeItem,
  SubagentItem,
  ThinkingItem,
  TimelineItem,
  TimelineState,
  ToolGroupItem,
  ToolItem,
  UserMessageItem,
} from './timeline.types';

/**
 * Creates a clean, empty TimelineState.
 */
export function createInitialTimelineState(): TimelineState {
  return {
    items: [],
    lastSeq: 0,
    activeRunId: null,
    lastUsage: null,
  };
}

/**
 * Returns true if a tool call kind should be grouped with adjacent ones.
 * Per spec: 2 or more consecutive tools with kind `view_file` or `search` in the same run.
 */
export function isGroupableToolKind(kind: ToolKind): boolean {
  return kind === 'view_file' || kind === 'search';
}

/**
 * Calculates duration in milliseconds between two ISO date strings.
 */
function calculateDurationMs(startedAt: ISODateString, endedAt: ISODateString): number | null {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }
  return Math.max(0, end - start);
}

/**
 * Recursively searches and immutably updates a tool by toolCallId across items.
 * A tool can be either a top-level ToolItem or nested inside a ToolGroupItem.
 */
function updateToolInItems(
  items: readonly TimelineItem[],
  toolCallId: string,
  updater: (tool: ToolItem) => ToolItem
): { items: TimelineItem[]; found: boolean } {
  let found = false;

  const nextItems: TimelineItem[] = items.map((item) => {
    if (item.kind === 'tool' && item.toolCallId === toolCallId) {
      found = true;
      return updater(item);
    }

    if (item.kind === 'tool_group') {
      const toolIdx = item.tools.findIndex((t) => t.toolCallId === toolCallId);
      if (toolIdx !== -1) {
        found = true;
        const updatedTool = updater(item.tools[toolIdx]);
        const updatedTools = item.tools.map((t, i) => (i === toolIdx ? updatedTool : t));
        const updatedGroup: ToolGroupItem = {
          ...item,
          tools: updatedTools,
          updatedAt: updatedTool.updatedAt,
        };
        return updatedGroup;
      }
    }

    return item;
  });

  return { items: nextItems, found };
}

/**
 * Recursively searches and immutably updates a subagent by conversationId.
 * A subagent can be top-level, mounted under a top-level ToolItem,
 * or mounted under a ToolItem inside a ToolGroupItem.
 */
function updateSubagentInItems(
  items: readonly TimelineItem[],
  conversationId: string,
  updater: (subagent: SubagentItem) => SubagentItem
): { items: TimelineItem[]; found: boolean } {
  let found = false;

  const nextItems: TimelineItem[] = items.map((item) => {
    if (item.kind === 'subagent' && item.conversationId === conversationId) {
      found = true;
      return updater(item);
    }

    if (item.kind === 'tool') {
      const subIdx = item.subagents.findIndex((s) => s.conversationId === conversationId);
      if (subIdx !== -1) {
        found = true;
        const updatedSubagents = item.subagents.map((s, i) =>
          i === subIdx ? updater(s) : s
        );
        return {
          ...item,
          subagents: updatedSubagents,
        };
      }
    }

    if (item.kind === 'tool_group') {
      let groupChanged = false;
      const updatedTools = item.tools.map((tool) => {
        const subIdx = tool.subagents.findIndex((s) => s.conversationId === conversationId);
        if (subIdx !== -1) {
          found = true;
          groupChanged = true;
          const updatedSubagents = tool.subagents.map((s, i) =>
            i === subIdx ? updater(s) : s
          );
          return {
            ...tool,
            subagents: updatedSubagents,
          };
        }
        return tool;
      });

      if (groupChanged) {
        return {
          ...item,
          tools: updatedTools,
        };
      }
    }

    return item;
  });

  return { items: nextItems, found };
}

/**
 * Appends or groups a newly started ToolItem according to grouping rules:
 * Consecutive 2+ kind of `view_file` or `search` tools in the same run merge into ToolGroup.
 */
function insertToolItem(items: readonly TimelineItem[], toolItem: ToolItem): TimelineItem[] {
  if (!isGroupableToolKind(toolItem.tool.kind)) {
    return [...items, toolItem];
  }

  const lastItem = items.length > 0 ? items[items.length - 1] : undefined;

  // Check if last item is in the same run
  if (lastItem && lastItem.runId === toolItem.runId) {
    if (lastItem.kind === 'tool_group') {
      // Append to existing group
      const updatedGroup: ToolGroupItem = {
        ...lastItem,
        tools: [...lastItem.tools, toolItem],
        updatedAt: toolItem.updatedAt,
      };
      return [...items.slice(0, -1), updatedGroup];
    }

    if (lastItem.kind === 'tool' && isGroupableToolKind(lastItem.tool.kind)) {
      // Form a new ToolGroup from the 2 consecutive groupable tools
      const newGroup: ToolGroupItem = {
        id: `tool-group-${lastItem.toolCallId}`,
        kind: 'tool_group',
        type: 'tool_group',
        tools: [lastItem, toolItem],
        runId: toolItem.runId,
        createdAt: lastItem.createdAt,
        updatedAt: toolItem.updatedAt,
      };
      return [...items.slice(0, -1), newGroup];
    }
  }

  // Not groupable with previous item
  return [...items, toolItem];
}

/**
 * Inserts or mounts a subagent item either under its parentToolCallId or at top-level.
 */
function insertSubagentItem(items: readonly TimelineItem[], subagent: SubagentItem): TimelineItem[] {
  if (subagent.parentToolCallId !== null) {
    const { items: updatedItems, found } = updateToolInItems(
      items,
      subagent.parentToolCallId,
      (tool) => ({
        ...tool,
        subagents: [...tool.subagents, subagent],
      })
    );
    if (found) {
      return updatedItems;
    }
  }

  // If no parentToolCallId or parent tool wasn't found in items, place at top level
  return [...items, subagent];
}

function findToolInItems(items: readonly TimelineItem[], toolCallId: string): ToolItem | null {
  for (const item of items) {
    if (item.kind === 'tool' && item.toolCallId === toolCallId) {
      return item;
    }
    if (item.kind === 'tool_group') {
      const found = item.tools.find((t) => t.toolCallId === toolCallId);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function findSubagentInItems(
  items: readonly TimelineItem[],
  conversationId: string
): SubagentItem | null {
  for (const item of items) {
    if (item.kind === 'subagent' && item.conversationId === conversationId) {
      return item;
    }
    if (item.kind === 'tool') {
      const found = item.subagents.find((s) => s.conversationId === conversationId);
      if (found) {
        return found;
      }
    }
    if (item.kind === 'tool_group') {
      for (const tool of item.tools) {
        const found = tool.subagents.find((s) => s.conversationId === conversationId);
        if (found) {
          return found;
        }
      }
    }
  }
  return null;
}

/**
 * Inserts a transcript step keyed by stepIndex: an existing index is replaced,
 * otherwise the step is placed in ascending stepIndex order.
 */
function upsertStep(steps: readonly TranscriptStep[], step: TranscriptStep): TranscriptStep[] {
  const existingIdx = steps.findIndex((s) => s.stepIndex === step.stepIndex);
  if (existingIdx !== -1) {
    return steps.map((s, i) => (i === existingIdx ? step : s));
  }
  const insertAt = steps.findIndex((s) => s.stepIndex > step.stepIndex);
  if (insertAt === -1) {
    return [...steps, step];
  }
  return [...steps.slice(0, insertAt), step, ...steps.slice(insertAt)];
}

function createPlaceholderSubagent(
  conversationId: string,
  status: SubagentStatus,
  steps: TranscriptStep[],
  runId: string | null,
  ts: ISODateString
): SubagentItem {
  return {
    id: `subagent-${conversationId}`,
    kind: 'subagent',
    type: 'subagent',
    conversationId,
    role: 'subagent',
    typeName: 'subagent',
    initialPrompt: null,
    status,
    parentToolCallId: null,
    steps,
    runId,
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * `null` means the run ended normally; otherwise it is the error recorded on
 * tools that were still running when the run ended.
 */
type InterruptReason = string | null;

const INTERRUPT_REASON = {
  aborted: 'Run aborted before this step finished',
  failed: 'Run failed before this step finished',
  superseded: 'A new run started before this step finished',
} as const;

function closeSubagent(subagent: SubagentItem, reason: InterruptReason, ts: ISODateString): SubagentItem {
  if (subagent.status !== 'running') {
    return subagent;
  }
  return {
    ...subagent,
    status: reason === null ? 'completed' : 'failed',
    updatedAt: ts,
  };
}

function closeTool(item: ToolItem, reason: InterruptReason, ts: ISODateString): ToolItem {
  const subagents = item.subagents.map((s) => closeSubagent(s, reason, ts));
  const subagentsChanged = subagents.some((s, i) => s !== item.subagents[i]);
  const toolRunning = item.tool.status === 'running';
  if (!toolRunning && !subagentsChanged) {
    return item;
  }
  return {
    ...item,
    tool: toolRunning
      ? {
          ...item.tool,
          status: reason === null ? 'succeeded' : 'failed',
          error: reason === null ? item.tool.error : (item.tool.error ?? reason),
          endedAt: item.tool.endedAt ?? ts,
        }
      : item.tool,
    subagents: subagentsChanged ? subagents : item.subagents,
    updatedAt: ts,
  };
}

/**
 * Settles every still-open item of a run: running tools and subagents get a
 * terminal status, streaming messages and thinking blocks are marked complete.
 * The backend emits no tool.finished / message.done for steps cut off by an
 * abort or crash, so without this they would render as in-progress forever.
 */
function closeRunItems(
  items: readonly TimelineItem[],
  targetRunId: string | null,
  reason: InterruptReason,
  ts: ISODateString
): TimelineItem[] {
  let changed = false;
  const nextItems = items.map((item): TimelineItem => {
    if (item.runId !== targetRunId) {
      return item;
    }
    switch (item.kind) {
      case 'assistant_message': {
        if (item.isComplete) return item;
        changed = true;
        return { ...item, isComplete: true, updatedAt: ts };
      }
      case 'thinking': {
        if (item.isComplete) return item;
        changed = true;
        const durationMs = calculateDurationMs(item.startedAt, ts);
        return {
          ...item,
          isComplete: true,
          endedAt: ts,
          durationMs: durationMs ?? item.durationMs,
        };
      }
      case 'tool': {
        const closed = closeTool(item, reason, ts);
        if (closed !== item) changed = true;
        return closed;
      }
      case 'tool_group': {
        const tools = item.tools.map((t) => closeTool(t, reason, ts));
        if (tools.every((t, i) => t === item.tools[i])) return item;
        changed = true;
        return { ...item, tools, updatedAt: ts };
      }
      case 'subagent': {
        const closed = closeSubagent(item, reason, ts);
        if (closed !== item) changed = true;
        return closed;
      }
      default:
        return item;
    }
  });
  return changed ? nextItems : (items as TimelineItem[]);
}

/**
 * Pure reducer function mapping a sequence of session events into a TimelineState.
 * Guarantees that neither `state` nor `envelope` is mutated.
 */
export function reduce(
  state: TimelineState = createInitialTimelineState(),
  envelope: SessionEventEnvelope
): TimelineState {
  const { event, seq, runId, ts } = envelope;
  const lastSeq = Math.max(state.lastSeq, seq);
  // Only run.started / run.completed may change the active run; events that
  // straggle in after run.completed must not revive it.
  const activeRunId = state.activeRunId;

  switch (event.type) {
    case 'run.started': {
      const previousRunId = state.activeRunId;
      const items =
        previousRunId !== null && previousRunId !== event.runId
          ? closeRunItems(state.items, previousRunId, INTERRUPT_REASON.superseded, ts)
          : state.items;
      return {
        ...state,
        items,
        lastSeq,
        activeRunId: event.runId,
      };
    }

    case 'user.message': {
      const userItem: UserMessageItem = {
        id: `user-msg-${event.messageId}`,
        kind: 'user_message',
        type: 'user_message',
        messageId: event.messageId,
        text: event.text,
        attachments: event.attachments ? [...event.attachments] : [],
        runId: runId ?? state.activeRunId,
        createdAt: ts,
      };
      return {
        ...state,
        items: [...state.items, userItem],
        lastSeq,
        activeRunId,
      };
    }

    case 'thinking.delta': {
      const idx = state.items.findIndex(
        (it) => it.kind === 'thinking' && it.blockId === event.blockId
      );

      if (idx === -1) {
        const thinkingItem: ThinkingItem = {
          id: `thinking-${event.blockId}`,
          kind: 'thinking',
          type: 'thinking',
          blockId: event.blockId,
          source: event.source,
          text: event.text,
          startedAt: ts,
          endedAt: ts,
          durationMs: 0,
          isComplete: false,
          runId: runId ?? state.activeRunId,
        };
        return {
          ...state,
          items: [...state.items, thinkingItem],
          lastSeq,
          activeRunId,
        };
      }

      const existing = state.items[idx] as ThinkingItem;
      const durationMs = calculateDurationMs(existing.startedAt, ts);
      const updated: ThinkingItem = {
        ...existing,
        text: existing.text + event.text,
        // ★ 修复 A-4：已完成时保护权威的 endedAt 和 durationMs，防止迟到 delta 覆盖
        endedAt: existing.isComplete ? existing.endedAt : ts,
        durationMs: existing.isComplete ? existing.durationMs : (durationMs ?? existing.durationMs),
      };
      return {
        ...state,
        items: state.items.map((it, i) => (i === idx ? updated : it)),
        lastSeq,
        activeRunId,
      };
    }

    case 'thinking.done': {
      const idx = state.items.findIndex(
        (it) => it.kind === 'thinking' && it.blockId === event.blockId
      );

      if (idx === -1) {
        const thinkingItem: ThinkingItem = {
          id: `thinking-${event.blockId}`,
          kind: 'thinking',
          type: 'thinking',
          blockId: event.blockId,
          source: 'stream',
          text: '',
          startedAt: ts,
          endedAt: ts,
          durationMs: event.durationMs ?? 0,
          isComplete: true,
          runId: runId ?? state.activeRunId,
        };
        return {
          ...state,
          items: [...state.items, thinkingItem],
          lastSeq,
          activeRunId,
        };
      }

      const existing = state.items[idx] as ThinkingItem;
      const calculatedDuration = calculateDurationMs(existing.startedAt, ts);
      const finalDuration =
        event.durationMs !== null
          ? event.durationMs
          : (calculatedDuration ?? existing.durationMs);

      const updated: ThinkingItem = {
        ...existing,
        isComplete: true,
        endedAt: ts,
        durationMs: finalDuration,
      };
      return {
        ...state,
        items: state.items.map((it, i) => (i === idx ? updated : it)),
        lastSeq,
        activeRunId,
      };
    }

    case 'message.delta': {
      const idx = state.items.findIndex(
        (it) => it.kind === 'assistant_message' && it.messageId === event.messageId
      );

      if (idx === -1) {
        const messageItem: AssistantMessageItem = {
          id: `assistant-msg-${event.messageId}`,
          kind: 'assistant_message',
          type: 'assistant_message',
          messageId: event.messageId,
          text: event.text,
          isComplete: false,
          runId: runId ?? state.activeRunId,
          createdAt: ts,
          updatedAt: ts,
        };
        return {
          ...state,
          items: [...state.items, messageItem],
          lastSeq,
          activeRunId,
        };
      }

      const existing = state.items[idx] as AssistantMessageItem;
      const updated: AssistantMessageItem = {
        ...existing,
        text: existing.text + event.text,
        updatedAt: ts,
      };
      return {
        ...state,
        items: state.items.map((it, i) => (i === idx ? updated : it)),
        lastSeq,
        activeRunId,
      };
    }

    case 'message.done': {
      const idx = state.items.findIndex(
        (it) => it.kind === 'assistant_message' && it.messageId === event.messageId
      );

      if (idx === -1) {
        const messageItem: AssistantMessageItem = {
          id: `assistant-msg-${event.messageId}`,
          kind: 'assistant_message',
          type: 'assistant_message',
          messageId: event.messageId,
          text: '',
          isComplete: true,
          runId: runId ?? state.activeRunId,
          createdAt: ts,
          updatedAt: ts,
        };
        return {
          ...state,
          items: [...state.items, messageItem],
          lastSeq,
          activeRunId,
        };
      }

      const existing = state.items[idx] as AssistantMessageItem;
      const updated: AssistantMessageItem = {
        ...existing,
        isComplete: true,
        updatedAt: ts,
      };
      return {
        ...state,
        items: state.items.map((it, i) => (i === idx ? updated : it)),
        lastSeq,
        activeRunId,
      };
    }

    case 'tool.started': {
      const { items, found } = updateToolInItems(
        state.items,
        event.tool.toolCallId,
        (t) => ({
          ...t,
          tool: { ...event.tool },
          updatedAt: ts,
        })
      );

      if (found) {
        return {
          ...state,
          items,
          lastSeq,
          activeRunId,
        };
      }

      // ★ 修复 A-3：回收可能先到达的流浪子代理
      const strandedSubagents = state.items.filter(
        (it): it is SubagentItem =>
          it.kind === 'subagent' && it.parentToolCallId === event.tool.toolCallId
      );
      const newToolItem: ToolItem = {
        id: `tool-${event.tool.toolCallId}`,
        kind: 'tool',
        type: 'tool',
        toolCallId: event.tool.toolCallId,
        tool: { ...event.tool },
        subagents: strandedSubagents,
        runId: runId ?? state.activeRunId,
        createdAt: ts,
        updatedAt: ts,
      };

      const remainingItems = strandedSubagents.length > 0
        ? state.items.filter(
            (it) => !(it.kind === 'subagent' && it.parentToolCallId === event.tool.toolCallId)
          )
        : state.items;

      return {
        ...state,
        items: insertToolItem(remainingItems, newToolItem),
        lastSeq,
        activeRunId,
      };
    }

    case 'tool.updated': {
      const { items, found } = updateToolInItems(
        state.items,
        event.toolCallId,
        (t) => ({
          ...t,
          tool: {
            ...t.tool,
            ...event.patch,
            fileChanges: event.patch.fileChanges
              ? [...event.patch.fileChanges]
              : t.tool.fileChanges,
          },
          updatedAt: ts,
        })
      );

      if (found) {
        return {
          ...state,
          items,
          lastSeq,
          activeRunId,
        };
      }

      // If tool was not started yet, create a synthetic tool call and insert
      const fallbackTool: ToolCall = {
        toolCallId: event.toolCallId,
        name: 'unknown',
        kind: 'other',
        input: {},
        target: null,
        output: null,
        error: null,
        status: 'running',
        fileChanges: [],
        startedAt: ts,
        endedAt: null,
        ...event.patch,
      };

      // ★ 修复 A-3：回收可能先到达的流浪子代理
      const strandedSubagents = state.items.filter(
        (it): it is SubagentItem =>
          it.kind === 'subagent' && it.parentToolCallId === event.toolCallId
      );
      const newToolItem: ToolItem = {
        id: `tool-${event.toolCallId}`,
        kind: 'tool',
        type: 'tool',
        toolCallId: event.toolCallId,
        tool: fallbackTool,
        subagents: strandedSubagents,
        runId: runId ?? state.activeRunId,
        createdAt: ts,
        updatedAt: ts,
      };

      const remainingItems = strandedSubagents.length > 0
        ? state.items.filter(
            (it) => !(it.kind === 'subagent' && it.parentToolCallId === event.toolCallId)
          )
        : state.items;

      return {
        ...state,
        items: insertToolItem(remainingItems, newToolItem),
        lastSeq,
        activeRunId,
      };
    }

    case 'tool.finished': {
      const { items, found } = updateToolInItems(
        state.items,
        event.tool.toolCallId,
        (t) => ({
          ...t,
          tool: { ...event.tool },
          updatedAt: ts,
        })
      );

      if (found) {
        return {
          ...state,
          items,
          lastSeq,
          activeRunId,
        };
      }

      // ★ 修复 A-3：回收可能先到达的流浪子代理
      const strandedSubagents = state.items.filter(
        (it): it is SubagentItem =>
          it.kind === 'subagent' && it.parentToolCallId === event.tool.toolCallId
      );
      const newToolItem: ToolItem = {
        id: `tool-${event.tool.toolCallId}`,
        kind: 'tool',
        type: 'tool',
        toolCallId: event.tool.toolCallId,
        tool: { ...event.tool },
        subagents: strandedSubagents,
        runId: runId ?? state.activeRunId,
        createdAt: ts,
        updatedAt: ts,
      };

      const remainingItems = strandedSubagents.length > 0
        ? state.items.filter(
            (it) => !(it.kind === 'subagent' && it.parentToolCallId === event.tool.toolCallId)
          )
        : state.items;

      return {
        ...state,
        items: insertToolItem(remainingItems, newToolItem),
        lastSeq,
        activeRunId,
      };
    }

    case 'subagent.spawned': {
      const info = event.subagent;
      const existing = findSubagentInItems(state.items, info.conversationId);

      if (existing) {
        const merged: SubagentItem = {
          ...existing,
          role: info.role,
          typeName: info.typeName,
          initialPrompt: info.initialPrompt ?? existing.initialPrompt,
          // A subagent.finished that arrived first already holds the real outcome.
          status: existing.status === 'running' ? info.status : existing.status,
          parentToolCallId: existing.parentToolCallId ?? event.parentToolCallId,
          updatedAt: ts,
        };

        const shouldReparent =
          existing.parentToolCallId === null &&
          event.parentToolCallId !== null &&
          findToolInItems(state.items, event.parentToolCallId) !== null;

        const items = shouldReparent
          ? insertSubagentItem(
              state.items.filter(
                (it) => !(it.kind === 'subagent' && it.conversationId === info.conversationId)
              ),
              merged
            )
          : updateSubagentInItems(state.items, info.conversationId, () => merged).items;

        return {
          ...state,
          items,
          lastSeq,
          activeRunId,
        };
      }

      const subagentItem: SubagentItem = {
        id: `subagent-${event.subagent.conversationId}`,
        kind: 'subagent',
        type: 'subagent',
        conversationId: event.subagent.conversationId,
        role: event.subagent.role,
        typeName: event.subagent.typeName,
        initialPrompt: event.subagent.initialPrompt,
        status: event.subagent.status,
        parentToolCallId: event.parentToolCallId,
        steps: [],
        runId: runId ?? state.activeRunId,
        createdAt: ts,
        updatedAt: ts,
      };

      return {
        ...state,
        items: insertSubagentItem(state.items, subagentItem),
        lastSeq,
        activeRunId,
      };
    }

    case 'subagent.step': {
      const stepCopy = {
        ...event.step,
        toolCalls: event.step.toolCalls ? [...event.step.toolCalls] : [],
      };

      const { items, found } = updateSubagentInItems(
        state.items,
        event.conversationId,
        (s) => ({
          ...s,
          steps: upsertStep(s.steps, stepCopy),
          updatedAt: ts,
        })
      );

      if (found) {
        return {
          ...state,
          items,
          lastSeq,
          activeRunId,
        };
      }

      // If subagent wasn't spawned yet, synthesize top-level subagent
      const fallbackSubagent = createPlaceholderSubagent(
        event.conversationId,
        'running',
        [stepCopy],
        runId ?? state.activeRunId,
        ts
      );

      return {
        ...state,
        items: [...state.items, fallbackSubagent],
        lastSeq,
        activeRunId,
      };
    }

    case 'subagent.finished': {
      const { items, found } = updateSubagentInItems(
        state.items,
        event.conversationId,
        (s) => ({
          ...s,
          status: event.status,
          updatedAt: ts,
        })
      );

      if (found) {
        return {
          ...state,
          items,
          lastSeq,
          activeRunId,
        };
      }

      const placeholder = createPlaceholderSubagent(
        event.conversationId,
        event.status,
        [],
        runId ?? state.activeRunId,
        ts
      );

      return {
        ...state,
        items: [...state.items, placeholder],
        lastSeq,
        activeRunId,
      };
    }

    case 'run.completed': {
      const completedRunId = runId ?? state.activeRunId;
      const closedItems = closeRunItems(
        state.items,
        completedRunId,
        event.status === 'completed' ? null : INTERRUPT_REASON[event.status],
        ts
      );

      const divider: RunDividerItem = {
        id: `run-divider-${runId ?? seq}`,
        kind: 'run_divider',
        type: 'run_divider',
        runId: completedRunId,
        status: event.status,
        durationMs: event.durationMs,
        usage: event.usage ? { ...event.usage } : null,
        error: event.error ? { ...event.error } : null,
        agyConversationId: event.agyConversationId,
        timestamp: ts,
      };

      return {
        ...state,
        items: [...closedItems, divider],
        lastSeq,
        // A late run.completed for an older run must not clear the current one.
        activeRunId:
          completedRunId === null || completedRunId === state.activeRunId
            ? null
            : state.activeRunId,
      };
    }

    case 'run.error': {
      const errorItem: ErrorItem = {
        id: `error-${seq}`,
        kind: 'error',
        type: 'error',
        error: { ...event.error },
        runId: runId ?? state.activeRunId,
        timestamp: ts,
      };

      return {
        ...state,
        items: [...state.items, errorItem],
        lastSeq,
        activeRunId,
      };
    }

    case 'run.stalled': {
      const stalledItem: StalledNoticeItem = {
        id: `stalled-${seq}`,
        kind: 'stalled_notice',
        type: 'stalled_notice',
        idleMs: event.idleMs,
        runId: runId ?? state.activeRunId,
        timestamp: ts,
      };

      return {
        ...state,
        items: [...state.items, stalledItem],
        lastSeq,
        activeRunId,
      };
    }

    case 'usage': {
      return {
        ...state,
        lastUsage: { ...event.usage },
        lastSeq,
        activeRunId,
      };
    }

    case 'raw':
    case 'autoapprove.injected': {
      // Ignored for timeline items per spec
      return {
        ...state,
        lastSeq,
        activeRunId,
      };
    }

    default: {
      // Unhandled / unknown events are safely ignored
      const _exhaustiveCheck: never = event;
      void _exhaustiveCheck;
      return {
        ...state,
        lastSeq,
        activeRunId,
      };
    }
  }
}

/**
 * Reduces a collection of session envelopes sequentially into a single TimelineState.
 */
export function reduceAll(
  envelopes: Iterable<SessionEventEnvelope>,
  initialState: TimelineState = createInitialTimelineState()
): TimelineState {
  let state = initialState;
  for (const env of envelopes) {
    state = reduce(state, env);
  }
  return state;
}

/**
 * Utility to find a tool across items, whether top-level or inside a ToolGroupItem.
 */
export function findTool(state: TimelineState, toolCallId: string): ToolItem | null {
  return findToolInItems(state.items, toolCallId);
}

/**
 * Utility to find a subagent across items (top-level, inside ToolItem, or inside ToolGroupItem).
 */
export function findSubagent(state: TimelineState, conversationId: string): SubagentItem | null {
  return findSubagentInItems(state.items, conversationId);
}
