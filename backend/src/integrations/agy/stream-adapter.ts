import type {
  AgentEvent,
  ApiErrorBody,
  ErrorCode,
  FileChange,
  TokenUsage,
  ToolCall,
  ToolKind,
} from '@agy-studio/contracts';
import type { AgyProfile } from './profile/schema.js';
import {
  RawInitEventSchema,
  RawResultEventSchema,
  RawStepUpdateEventSchema,
  type RawUsage,
} from './stream-schema.js';

/**
 * Built-in mapping of standard agy tools to unified ToolKind.
 */
export const DEFAULT_TOOL_KIND_MAP: Record<string, ToolKind> = {
  // view_file
  view_file: 'view_file',
  read_resource: 'view_file',

  // write_file
  write_to_file: 'write_file',

  // edit_file
  replace_file_content: 'edit_file',
  multi_replace_file_content: 'edit_file',
  sed_file: 'edit_file',
  notebook_edit: 'edit_file',

  // run_command
  run_command: 'run_command',
  send_command_input: 'run_command',
  command_status: 'run_command',
  notebook_execution: 'run_command',

  // search
  grep_search: 'search',
  find_by_name: 'search',
  list_dir: 'search',
  search_web: 'search',

  // browser
  browser_click_element: 'browser',
  browser_drag_pixel_to_pixel: 'browser',
  browser_get_dom: 'browser',
  browser_get_network_request: 'browser',
  browser_input: 'browser',
  browser_list_network_requests: 'browser',
  browser_mouse_down: 'browser',
  browser_mouse_up: 'browser',
  browser_move_mouse: 'browser',
  browser_press_key: 'browser',
  browser_refresh_page: 'browser',
  browser_resize_window: 'browser',
  browser_scroll: 'browser',
  browser_scroll_dom: 'browser',
  browser_select_option: 'browser',
  click_browser_pixel: 'browser',
  capture_browser_console_logs: 'browser',
  capture_browser_screenshot: 'browser',
  execute_browser_javascript: 'browser',
  list_browser_pages: 'browser',
  open_browser_url: 'browser',
  read_browser_page: 'browser',
  read_url_content: 'browser',

  // subagent
  invoke_subagent: 'subagent',
  define_subagent: 'subagent',
  manage_subagents: 'subagent',
  browser_subagent: 'subagent',

  // mcp
  call_mcp_tool: 'mcp',

  // other
  ask_permission: 'other',
  ask_custom_permission: 'other',
  ask_question: 'other',
  manage_task: 'other',
  manage_inbox: 'other',
  list_permissions: 'other',
  list_resources: 'other',
  delete_knowledge: 'other',
  generate_image: 'other',
  wait: 'other',
  wait_5_seconds: 'other',
  finish: 'other',
  schedule: 'other',
  send_message: 'other',
};

/**
 * Resolves tool kind from tool name with profile override support and heuristic fallbacks.
 */
export function resolveToolKind(name: string, profile?: AgyProfile): ToolKind {
  // Allow profile override if configured
  const profileOverride = (profile as { toolKindMap?: Record<string, ToolKind> } | undefined)
    ?.toolKindMap?.[name];
  if (profileOverride) {
    return profileOverride;
  }

  const defaultMapped = DEFAULT_TOOL_KIND_MAP[name];
  if (defaultMapped) {
    return defaultMapped;
  }

  // Heuristic fallbacks
  if (name.startsWith('browser_')) {
    return 'browser';
  }
  if (name.startsWith('mcp_') || name.startsWith('call_mcp_')) {
    return 'mcp';
  }
  if (name.includes('subagent')) {
    return 'subagent';
  }
  if (name.includes('file') && (name.includes('edit') || name.includes('replace'))) {
    return 'edit_file';
  }
  if (name.includes('file') && name.includes('write')) {
    return 'write_file';
  }
  if (name.includes('search') || name.includes('find')) {
    return 'search';
  }

  return 'other';
}

/**
 * Common parameter keys for file paths in file editing/writing tools.
 */
const FILE_PATH_PARAM_KEYS = [
  'TargetFile',
  'target_file',
  'targetFile',
  'FilePath',
  'file_path',
  'filePath',
  'Path',
  'path',
  'File',
  'file',
  'Destination',
  'destination',
];

/**
 * Extracts FileChange information from tool parameters for editing/writing tools.
 */
export function extractFileChanges(
  toolName: string,
  kind: ToolKind,
  input: Record<string, unknown>
): FileChange[] {
  if (kind !== 'write_file' && kind !== 'edit_file') {
    return [];
  }

  let targetPath: string | undefined;
  for (const key of FILE_PATH_PARAM_KEYS) {
    const val = input[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      targetPath = val.trim();
      break;
    }
  }

  if (!targetPath) {
    return [];
  }

  let changeType: FileChange['changeType'] = 'modified';
  if (kind === 'write_file' || toolName === 'write_to_file') {
    changeType = 'created';
  } else if (toolName.includes('delete') || toolName.includes('remove')) {
    changeType = 'deleted';
  }

  const additions = typeof input.additions === 'number' ? input.additions : null;
  const deletions = typeof input.deletions === 'number' ? input.deletions : null;

  return [
    {
      path: targetPath,
      changeType,
      additions,
      deletions,
    },
  ];
}

/**
 * Parameter keys holding each tool kind's subject, in priority order.
 * agy itself uses PascalCase (`CommandLine`, `AbsolutePath`, `TargetFile`);
 * the other spellings cover older/newer CLI versions.
 */
const TOOL_TARGET_PARAM_KEYS: Record<ToolKind, readonly string[]> = {
  run_command: ['CommandLine', 'Command', 'command', 'Cmd', 'cmd'],
  view_file: ['AbsolutePath', 'absolute_path', ...FILE_PATH_PARAM_KEYS],
  edit_file: ['AbsolutePath', 'absolute_path', ...FILE_PATH_PARAM_KEYS],
  write_file: ['AbsolutePath', 'absolute_path', ...FILE_PATH_PARAM_KEYS],
  search: [
    'Query',
    'query',
    'Pattern',
    'pattern',
    'SearchPath',
    'SearchDirectory',
    'DirectoryPath',
    'directory_path',
  ],
  browser: ['Url', 'URL', 'url', 'PageUrl'],
  mcp: ['ToolName', 'tool_name', 'toolName'],
  subagent: ['Role', 'role', 'Action'],
  other: [],
};

/**
 * Extracts the human-readable subject of a tool call (see `ToolCall.target`).
 */
export function extractToolTarget(kind: ToolKind, input: Record<string, unknown>): string | null {
  for (const key of TOOL_TARGET_PARAM_KEYS[kind]) {
    const val = input[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

/**
 * Converts raw token usage from agy stream into contract TokenUsage.
 */
function toTokenUsage(raw?: RawUsage): TokenUsage | undefined {
  if (!raw) return undefined;
  return {
    inputTokens: raw.input_tokens ?? 0,
    outputTokens: raw.output_tokens ?? 0,
    thinkingTokens: raw.thinking_tokens ?? 0,
    cacheReadTokens: raw.cache_read_tokens ?? 0,
    totalTokens: raw.total_tokens ?? 0,
  };
}

/**
 * Maps raw error message into ApiErrorBody with sensible error codes.
 */
function parseErrorToApiError(rawError?: string): ApiErrorBody {
  const message = rawError || 'Unknown agy execution error';
  const lower = message.toLowerCase();

  let code: ErrorCode = 'AGY_EXIT';
  if (lower.includes('quota') || lower.includes('exhausted') || lower.includes('rate limit')) {
    code = 'QUOTA_EXHAUSTED';
  } else if (
    lower.includes('not supported') ||
    lower.includes('invalid model') ||
    lower.includes('not recognized') ||
    lower.includes('bad request') ||
    lower.includes('invalid')
  ) {
    code = 'BAD_REQUEST';
  } else if (lower.includes('abort') || lower.includes('cancel')) {
    code = 'AGY_ABORTED';
  }

  return {
    code,
    message,
    retryable: false,
  };
}

/**
 * Context passed to adapt function.
 */
export interface AdaptContext {
  runId: string;
  nextId(): string;
  now(): string;
  profile: AgyProfile;
}

/**
 * Result returned by adapt function.
 */
export interface AdaptResult {
  events: AgentEvent[];
  conversationId?: string;
  usage?: TokenUsage;
  terminal?: {
    status: 'completed' | 'failed' | 'aborted';
    error?: ApiErrorBody;
  };
  permissionRequest?: boolean;
}

/**
 * Checks whether an object matches the permissionEvent match criteria from profile.
 */
function matchesPermissionEvent(
  obj: Record<string, unknown>,
  config: { match: Record<string, unknown> } | null | undefined
): boolean {
  if (!config || !config.match) return false;
  const entries = Object.entries(config.match);
  if (entries.length === 0) return false;
  return entries.every(([k, v]) => obj[k] === v);
}

/**
 * Pure adapter function that transforms raw agy stream-json output lines into typed AgentEvents.
 * Guaranteed to never throw errors; invalid or unknown lines are downgraded to 'raw' events.
 */
export function adapt(line: unknown, ctx: AdaptContext): AdaptResult {
  // Step 1: Safely parse input into an object
  let rawObj: unknown = line;
  if (typeof line === 'string') {
    const trimmed = line.trim();
    if (!trimmed) {
      return { events: [] };
    }
    try {
      rawObj = JSON.parse(trimmed);
    } catch {
      return { events: [{ type: 'raw', payload: line }] };
    }
  }

  if (!rawObj || typeof rawObj !== 'object' || Array.isArray(rawObj)) {
    return { events: [{ type: 'raw', payload: line }] };
  }

  const record = rawObj as Record<string, unknown>;

  // Step 2: Detect permission events based on profile.stream.permissionEvent
  let permissionRequest: boolean | undefined = undefined;
  if (matchesPermissionEvent(record, ctx.profile.stream.permissionEvent)) {
    permissionRequest = true;
  }

  // Step 3: Check event type using profile.stream.eventTypeMap
  const rawEventName = typeof record.event === 'string' ? record.event : undefined;
  if (!rawEventName) {
    return { events: [{ type: 'raw', payload: rawObj }], permissionRequest };
  }

  const mappedType = ctx.profile.stream.eventTypeMap[rawEventName];
  if (!mappedType) {
    return { events: [{ type: 'raw', payload: rawObj }], permissionRequest };
  }

  // Step 4: Dispatch based on mapped event type
  switch (mappedType) {
    case 'init': {
      const parsed = RawInitEventSchema.safeParse(record);
      if (!parsed.success) {
        return { events: [{ type: 'raw', payload: rawObj }], permissionRequest };
      }
      return {
        events: [],
        conversationId: parsed.data.conversation_id || undefined,
        permissionRequest,
      };
    }

    case 'step_update': {
      const parsed = RawStepUpdateEventSchema.safeParse(record);
      if (!parsed.success) {
        return { events: [{ type: 'raw', payload: rawObj }], permissionRequest };
      }

      const step = parsed.data.step_update;
      const conversationId = step.conversation_id || undefined;
      const events: AgentEvent[] = [];
      const usage = toTokenUsage(step.usage);

      if (usage) {
        events.push({ type: 'usage', usage });
      }

      switch (step.step_type) {
        case 'user_input': {
          // user.message is tracked by session service / supervisor at start of run
          break;
        }

        case 'agent_response': {
          const messageId = `msg-${ctx.runId}-${step.step_index}`;
          const hasDelta = typeof step.text_delta === 'string' && step.text_delta.length > 0;
          if (hasDelta) {
            events.push({
              type: 'message.delta',
              messageId,
              text: step.text_delta!,
            });
          }
          if (step.state === 'DONE' && (hasDelta || step.text_delta !== undefined)) {
            events.push({
              type: 'message.done',
              messageId,
            });
          }
          break;
        }

        case 'tool':
        case 'subagent': {
          const toolCallId = `tool-${ctx.runId}-${step.step_index}`;
          const toolName = step.tool_name ?? step.tool_info?.name ?? 'unknown_tool';
          const kind =
            step.step_type === 'subagent' ? 'subagent' : resolveToolKind(toolName, ctx.profile);
          const input = (step.tool_info?.parameters as Record<string, unknown> | undefined) ?? {};
          const output = typeof step.tool_info?.output === 'string' ? step.tool_info.output : null;
          const fileChanges = extractFileChanges(toolName, kind, input);
          const target = extractToolTarget(kind, input);

          if (step.state === 'ACTIVE') {
            const tool: ToolCall = {
              toolCallId,
              name: toolName,
              kind,
              input,
              target,
              output: output ?? null,
              error: null,
              status: 'running',
              fileChanges,
              startedAt: ctx.now(),
              endedAt: null,
            };
            events.push({ type: 'tool.started', tool });
          } else {
            const tool: ToolCall = {
              toolCallId,
              name: toolName,
              kind,
              input,
              target,
              output: output ?? null,
              error: null,
              status: 'succeeded',
              fileChanges,
              startedAt: ctx.now(),
              endedAt: ctx.now(),
            };
            events.push({ type: 'tool.finished', tool });

            // Spawn subagent event when subagent finishes spawning and returns conversationId
            if (step.subagent_info?.subagents) {
              for (const sub of step.subagent_info.subagents) {
                if (sub.conversation_id) {
                  events.push({
                    type: 'subagent.spawned',
                    parentToolCallId: toolCallId,
                    subagent: {
                      conversationId: sub.conversation_id,
                      role: sub.role ?? 'subagent',
                      typeName: sub.type_name ?? 'subagent',
                      initialPrompt: sub.initial_prompt ?? null,
                      status: 'running',
                    },
                  });
                }
              }
            }
          }
          break;
        }

        case 'system_message': {
          // Internal system message, no agent event needed
          break;
        }

        case 'error_message': {
          // Model/quota error step (e.g. weekly quota exhausted); the run's final status still comes from `result`
          const pick = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);
          const message =
            pick(step.text_delta) ?? pick(step.content) ?? pick(step.error) ?? 'error_message';
          events.push({ type: 'run.error', error: parseErrorToApiError(message) });
          break;
        }

        default: {
          return { events: [{ type: 'raw', payload: rawObj }], permissionRequest };
        }
      }

      return {
        events,
        conversationId,
        usage,
        permissionRequest,
      };
    }

    case 'result': {
      const parsed = RawResultEventSchema.safeParse(record);
      if (!parsed.success) {
        return { events: [{ type: 'raw', payload: rawObj }], permissionRequest };
      }

      const res = parsed.data.result;
      const conversationId = res.conversation_id || undefined;
      const usage = toTokenUsage(res.usage);
      const events: AgentEvent[] = [];

      if (usage) {
        events.push({ type: 'usage', usage });
      }

      const terminal: AdaptResult['terminal'] =
        res.status === 'SUCCESS'
          ? { status: 'completed' }
          : {
              status: 'failed',
              error: parseErrorToApiError(res.error),
            };

      return {
        events,
        conversationId,
        usage,
        terminal,
        permissionRequest,
      };
    }

    default: {
      return { events: [{ type: 'raw', payload: rawObj }], permissionRequest };
    }
  }
}
