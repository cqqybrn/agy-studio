import type {
  Account,
  AccountLoginSession,
  AccountType,
  AgentInfo,
  AgentMode,
  Attachment,
  Capabilities,
  Effort,
  Health,
  Model,
  Page,
  Prefs,
  QuotaSnapshot,
  Run,
  Session,
  TranscriptStep,
  WhoAmI,
  Workspace,
} from './domain';
import type { SessionEventEnvelope } from './events';

export const API_PREFIX = '/api';

export const UPLOAD_LIMITS = {
  imageMaxBytes: 20 * 1024 * 1024,
  fileMaxBytes: 50 * 1024 * 1024,
  maxFilesPerRequest: 10,
  imageMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
} as const;

// ---------- Request bodies ----------

export interface CreateWorkspaceBody {
  path: string;
  name?: string;
}

/** A folder on the machine running AGY Studio, for picking a workspace location. */
export interface DirectoryEntry {
  name: string;
  /** Absolute path. */
  path: string;
}

export interface DirectoryListing {
  /** The listed folder; null for the top level (drives on Windows). */
  path: string | null;
  /** Folder to go up to; null at the top level. On a drive root it is null too (back to drives). */
  parent: string | null;
  /** Sub-folders, sorted by name. Hidden and system folders are left out. */
  entries: DirectoryEntry[];
}

export interface CreateSessionBody {
  workspaceId: string;
  /** Defaults to the active account. Ignored in `credential_snapshot` mode, where every run uses the live account. */
  accountName?: string;
  title?: string;
  model?: string;
  effort?: Effort;
  mode?: AgentMode;
}

export interface UpdateSessionBody {
  title?: string;
  /** Pin to / unpin from the top of the session list. */
  pinned?: boolean;
  model?: string | null;
  effort?: Effort | null;
  mode?: AgentMode | null;
}

export interface ImportSessionsBody {
  workspaceId: string;
  /** Omit to import every on-disk agy conversation not yet known. */
  agyConversationIds?: string[];
}

export interface SaveAccountBody {
  name: string;
  note?: string;
  type?: AccountType;
  /** Required when `type` is `apikey`. */
  apiKey?: string;
}

export interface SwitchAccountBody {
  name: string;
}

export interface StartLoginBody {
  /** Profile name to save once login completes. */
  saveAs: string;
}

export type UpdatePrefsBody = Partial<Prefs>;

// ---------- Endpoint map ----------

/**
 * Every REST endpoint. Key = `METHOD path`. Path params use `:name`.
 * Errors always use `ApiErrorResponse` with the status from `ERROR_HTTP_STATUS`.
 */
export interface ApiEndpoints {
  'GET /api/health': { response: Health };
  'GET /api/capabilities': { response: Capabilities };

  'GET /api/workspaces': { response: Workspace[] };
  'POST /api/workspaces': { body: CreateWorkspaceBody; response: Workspace };
  'DELETE /api/workspaces/:workspaceId': { response: { ok: true } };
  /** Lists sub-folders of `path` (or the drives / filesystem root when omitted) for the folder picker. */
  'GET /api/fs/directories': { query: { path?: string }; response: DirectoryListing };

  'GET /api/sessions': {
    query: { workspaceId?: string; cursor?: string; limit?: number };
    response: Page<Session>;
  };
  'POST /api/sessions': { body: CreateSessionBody; response: Session };
  'GET /api/sessions/:sessionId': { response: Session };
  'PATCH /api/sessions/:sessionId': { body: UpdateSessionBody; response: Session };
  /** `purge=true` also removes agy brain/conversation files. Rejects with SESSION_BUSY while running. */
  'DELETE /api/sessions/:sessionId': { query: { purge?: boolean }; response: { ok: true } };
  'POST /api/sessions/import': { body: ImportSessionsBody; response: { imported: Session[] } };
  /**
   * Edit support: removes the user message and everything after it, both from the session history
   * and from agy's own conversation (agy also reverts the file changes it made in those turns).
   * The caller then sends the edited text as a new message. Rejects with SESSION_BUSY while running.
   * Broadcasts `session.reset`.
   */
  'POST /api/sessions/:sessionId/messages/:messageId/rewind': { response: { ok: true } };

  'GET /api/sessions/:sessionId/events': {
    query: { afterSeq?: number; limit?: number };
    response: { items: SessionEventEnvelope[]; latestSeq: number; hasMore: boolean };
  };
  'GET /api/sessions/:sessionId/runs': { response: Run[] };
  'GET /api/sessions/:sessionId/subagents/:conversationId/transcript': {
    query: { afterStep?: number; limit?: number };
    response: { steps: TranscriptStep[]; total: number };
  };

  /** multipart/form-data: fields `workspaceId`, optional `sessionId`, files under `files`. */
  'POST /api/attachments': { body: FormData; response: { attachments: Attachment[] } };
  'GET /api/attachments/:attachmentId/raw': { response: Blob };

  'GET /api/models': { query: { refresh?: boolean }; response: Model[] };
  /** Built-in default agent first, then workspace (`workspaceId`'s `.agents/agents`) and global agents. */
  'GET /api/agents': { query: { workspaceId?: string }; response: AgentInfo[] };
  'GET /api/prefs': { response: Prefs };
  'PUT /api/prefs': { body: UpdatePrefsBody; response: Prefs };

  /** `refresh=true` bypasses the cache and queries the quota endpoint (rate-limited server-side to once per minute per account). */
  'GET /api/quota': { query: { account?: string; refresh?: boolean }; response: QuotaSnapshot };

  'GET /api/accounts': { response: { accounts: Account[]; whoami: WhoAmI } };
  'POST /api/accounts/save': { body: SaveAccountBody; response: Account };
  /**
   * `isolated_home`: only changes the default account for new sessions; never busy.
   * `credential_snapshot`: swaps the live credential; rejects with ACCOUNT_BUSY while any run is active.
   */
  'POST /api/accounts/switch': { body: SwitchAccountBody; response: { whoami: WhoAmI } };
  'DELETE /api/accounts/:name': { response: { ok: true } };
  'POST /api/accounts/login': { body: StartLoginBody; response: AccountLoginSession };
  'GET /api/accounts/login/:loginId': { response: AccountLoginSession };
  'DELETE /api/accounts/login/:loginId': { response: AccountLoginSession };
}

export type EndpointKey = keyof ApiEndpoints;
export type EndpointResponse<K extends EndpointKey> = ApiEndpoints[K]['response'];
