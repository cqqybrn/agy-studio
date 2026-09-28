import type { ApiErrorBody } from './errors';

export type ISODateString = string;

export interface Page<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

// ---------- Workspace ----------

export interface Workspace {
  id: string;
  name: string;
  /** Absolute path; used as the agy process cwd. */
  path: string;
  isGitRepo: boolean;
  createdAt: ISODateString;
  lastOpenedAt: ISODateString;
}

// ---------- Session / Run ----------

export type Effort = 'low' | 'medium' | 'high' | 'max';

/** Passed through to `agy --mode`; valid values come from `Capabilities.modes`. */
export type AgentMode = string;

export type SessionStatus = 'idle' | 'running' | 'error';

export type SessionSource = 'studio' | 'imported';

export interface Session {
  id: string;
  workspaceId: string;
  title: string;
  /** Native agy conversation id; null until the first run emits `init`. */
  agyConversationId: string | null;
  status: SessionStatus;
  model: string | null;
  effort: Effort | null;
  mode: AgentMode | null;
  source: SessionSource;
  /** Account the conversation is pinned to after its first run; agy conversation files live under that account's profile. */
  accountName: string | null;
  lastRunId: string | null;
  lastSeq: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type RunStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'stalled'
  | 'completed'
  | 'failed'
  | 'aborted';

export type TerminalRunStatus = Extract<RunStatus, 'completed' | 'failed' | 'aborted'>;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

export interface Run {
  id: string;
  sessionId: string;
  status: RunStatus;
  model: string | null;
  accountName: string | null;
  checkpointId: string | null;
  usage: TokenUsage | null;
  error: ApiErrorBody | null;
  startedAt: ISODateString;
  endedAt: ISODateString | null;
}

// ---------- Tools / Subagents ----------

export type ToolKind =
  | 'view_file'
  | 'edit_file'
  | 'write_file'
  | 'run_command'
  | 'search'
  | 'browser'
  | 'subagent'
  | 'mcp'
  | 'other';

export type ToolStatus = 'running' | 'succeeded' | 'failed';

export interface FileChange {
  path: string;
  changeType: 'created' | 'modified' | 'deleted';
  additions: number | null;
  deletions: number | null;
}

export interface ToolCall {
  toolCallId: string;
  /** Raw agy tool name, e.g. `run_command`. */
  name: string;
  kind: ToolKind;
  /** Raw agy parameters; key names vary by agy version, so the UI must not rely on them. */
  input: Record<string, unknown>;
  /**
   * What the call acts on, extracted from `input` by the backend: command line for
   * `run_command`, file path for file tools, query for `search`, URL for `browser`.
   * Null when the tool has no recognisable subject.
   */
  target: string | null;
  output: string | null;
  error: string | null;
  status: ToolStatus;
  fileChanges: FileChange[];
  startedAt: ISODateString;
  endedAt: ISODateString | null;
}

export type SubagentStatus = 'running' | 'completed' | 'failed';

export interface SubagentInfo {
  conversationId: string;
  role: string;
  typeName: string;
  initialPrompt: string | null;
  status: SubagentStatus;
}

export interface TranscriptToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface TranscriptStep {
  stepIndex: number;
  type: string;
  status: string | null;
  createdAt: ISODateString | null;
  content: string | null;
  thinking: string | null;
  toolCalls: TranscriptToolCall[];
  error: string | null;
}

// ---------- Artifacts ----------

export type ArtifactKind =
  | 'task'
  | 'implementation_plan'
  | 'walkthrough'
  | 'markdown'
  | 'image'
  | 'recording'
  | 'other';

export interface Artifact {
  /** Stable id: url-safe encoding of `conversationId/relativePath`. */
  id: string;
  sessionId: string;
  conversationId: string;
  kind: ArtifactKind;
  name: string;
  relativePath: string;
  mimeType: string;
  size: number;
  version: number;
  updatedAt: ISODateString;
}

// ---------- Attachments ----------

export type AttachmentKind = 'image' | 'file';

export interface Attachment {
  id: string;
  workspaceId: string;
  sessionId: string | null;
  kind: AttachmentKind;
  originalName: string;
  mimeType: string;
  size: number;
  /** Absolute path inside `<workspace>/.agy-attachments/`. */
  storedPath: string;
  /** Text extracted from pdf/docx/xlsx; null when not applicable. */
  derivedTextPath: string | null;
  createdAt: ISODateString;
}

// ---------- Checkpoints ----------

export interface Checkpoint {
  id: string;
  workspaceId: string;
  sessionId: string;
  runId: string;
  commitSha: string;
  filesChanged: number | null;
  createdAt: ISODateString;
}

export interface CheckpointFileDiff {
  path: string;
  changeType: FileChange['changeType'];
  patch: string;
}

export interface CheckpointDiff {
  checkpointId: string;
  files: CheckpointFileDiff[];
}

// ---------- Models / Prefs ----------

export type ModelGroup = 'gemini' | 'third_party';

export interface Model {
  id: string;
  label: string;
  group: ModelGroup;
  isDefault: boolean;
}

export interface Prefs {
  defaultModel: string | null;
  defaultEffort: Effort | null;
  defaultMode: AgentMode | null;
  defaultWorkspaceId: string | null;
  showThinking: boolean;
  checkpointsEnabled: boolean;
  maxConcurrentRuns: number;
  stallTimeoutSeconds: number;
}

// ---------- Accounts ----------

export type AccountType = 'oauth' | 'apikey';

/**
 * `isolated_home`: each account runs agy with its own home directory, so accounts can run concurrently.
 * `credential_snapshot`: one shared live credential slot; switching swaps it and requires no active runs.
 */
export type AccountIsolation = 'isolated_home' | 'credential_snapshot';

export interface Account {
  name: string;
  type: AccountType;
  isolation: AccountIsolation;
  email: string | null;
  note: string | null;
  savedAt: ISODateString;
  /** Default account for new sessions. */
  active: boolean;
  activeRuns: number;
}

export interface WhoAmI {
  activeProfile: string | null;
  email: string | null;
  accountType: AccountType | null;
  isolation: AccountIsolation | null;
  credentialPresent: boolean;
}

export type LoginStatus = 'pending' | 'awaiting_browser' | 'completed' | 'failed' | 'cancelled';

export interface AccountLoginSession {
  loginId: string;
  status: LoginStatus;
  authUrl: string | null;
  email: string | null;
  error: string | null;
}

// ---------- Quota ----------

export type QuotaWindow = 'weekly' | '5h';

export interface QuotaBucket {
  bucketId: string;
  displayName: string;
  window: QuotaWindow;
  remainingFraction: number;
  resetTime: ISODateString | null;
  resetInSeconds: number | null;
  description: string | null;
  disabled: boolean;
}

export interface QuotaGroup {
  displayName: string;
  description: string | null;
  buckets: QuotaBucket[];
}

/**
 * `statusline`: captured passively from agy's official statusline hook during runs.
 * `cli_probe`: parsed from the official `/usage` command run in a pseudo-terminal.
 */
export type QuotaSource = 'statusline' | 'cli_probe' | 'unavailable';

export interface QuotaSnapshot {
  source: QuotaSource;
  accountName: string | null;
  email: string | null;
  planTier: string | null;
  title: string;
  description: string | null;
  groups: QuotaGroup[];
  credits: { available: boolean; balance: number | null };
  fetchedAt: ISODateString;
  cached: boolean;
  /** True when the latest refresh failed and `groups` come from an older fetch. */
  stale: boolean;
}

// ---------- System ----------

export type FeatureFlag =
  | 'mainThinkingStream'
  | 'multiTurnStdin'
  | 'nativeImageInput'
  | 'permissionEvents'
  | 'statuslineQuota'
  | 'cliUsageProbe'
  | 'credits'
  | 'isolatedHomes'
  | 'concurrentAccounts';

export interface Capabilities {
  agyPath: string | null;
  agyVersion: string | null;
  /** Version of the agy integration profile the backend loaded; mismatch with agyVersion means re-run discovery. */
  profileAgyVersion: string | null;
  autoApprove: true;
  modes: AgentMode[];
  features: Record<FeatureFlag, boolean>;
}

export interface Health {
  ok: boolean;
  version: string;
  uptimeSeconds: number;
  activeRuns: number;
  account: WhoAmI;
}
