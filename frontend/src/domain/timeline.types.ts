import type {
  Attachment,
  ISODateString,
  SubagentStatus,
  TerminalRunStatus,
  TokenUsage,
  ToolCall,
  TranscriptStep,
} from '@agy-studio/contracts';
import type { ApiErrorBody } from '@agy-studio/contracts';

/**
 * Discrimination kinds for all timeline items.
 * Strictly aligned with docs/ARCHITECTURE.md §2.10.
 */
export type TimelineItemKind =
  | 'user_message'
  | 'thinking'
  | 'assistant_message'
  | 'tool'
  | 'tool_group'
  | 'subagent'
  | 'run_divider'
  | 'error'
  | 'stalled_notice';

export type TimelineItemType = TimelineItemKind;

/**
 * User-submitted message item in the timeline.
 */
export interface UserMessageItem {
  id: string;
  kind: 'user_message';
  type: 'user_message';
  messageId: string;
  text: string;
  attachments: Attachment[];
  runId: string | null;
  createdAt: ISODateString;
}

/**
 * Agent thinking process item, accumulated across deltas.
 */
export interface ThinkingItem {
  id: string;
  kind: 'thinking';
  type: 'thinking';
  blockId: string;
  source: 'stream' | 'transcript';
  text: string;
  startedAt: ISODateString;
  endedAt: ISODateString | null;
  durationMs: number | null;
  isComplete: boolean;
  runId: string | null;
}

/**
 * Assistant response message item, accumulated across deltas.
 */
export interface AssistantMessageItem {
  id: string;
  kind: 'assistant_message';
  type: 'assistant_message';
  messageId: string;
  text: string;
  isComplete: boolean;
  runId: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/**
 * Individual tool invocation item.
 */
export interface ToolItem {
  id: string;
  kind: 'tool';
  type: 'tool';
  toolCallId: string;
  tool: ToolCall;
  subagents: SubagentItem[];
  runId: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/**
 * Group of 2 or more consecutive `view_file` or `search` tools in the same run.
 */
export interface ToolGroupItem {
  id: string;
  kind: 'tool_group';
  type: 'tool_group';
  tools: ToolItem[];
  runId: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/**
 * Subagent card item. Can be attached under a parent ToolItem or placed at top-level.
 */
export interface SubagentItem {
  id: string;
  kind: 'subagent';
  type: 'subagent';
  conversationId: string;
  role: string;
  typeName: string;
  initialPrompt: string | null;
  status: SubagentStatus;
  parentToolCallId: string | null;
  steps: TranscriptStep[];
  subagents?: SubagentItem[];
  runId: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/**
 * Run divider item emitted when a run completes.
 */
export interface RunDividerItem {
  id: string;
  kind: 'run_divider';
  type: 'run_divider';
  runId: string | null;
  status: TerminalRunStatus;
  durationMs: number;
  usage: TokenUsage | null;
  error: ApiErrorBody | null;
  agyConversationId: string | null;
  timestamp: ISODateString;
}

/**
 * Non-terminal run error notification item.
 */
export interface ErrorItem {
  id: string;
  kind: 'error';
  type: 'error';
  error: ApiErrorBody;
  runId: string | null;
  timestamp: ISODateString;
}

/**
 * Stalled notice item emitted when the run becomes idle beyond threshold.
 */
export interface StalledNoticeItem {
  id: string;
  kind: 'stalled_notice';
  type: 'stalled_notice';
  idleMs: number;
  runId: string | null;
  timestamp: ISODateString;
}

/**
 * Union of all timeline items.
 */
export type TimelineItem =
  | UserMessageItem
  | ThinkingItem
  | AssistantMessageItem
  | ToolItem
  | ToolGroupItem
  | SubagentItem
  | RunDividerItem
  | ErrorItem
  | StalledNoticeItem;

/**
 * Full timeline state managed for a session.
 */
export interface TimelineState {
  items: TimelineItem[];
  lastSeq: number;
  activeRunId: string | null;
  lastUsage: TokenUsage | null;
}
