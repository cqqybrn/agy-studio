import type {
  Account,
  AccountLoginSession,
  ApiEndpoints,
  Artifact,
  Attachment,
  Capabilities,
  Checkpoint,
  CheckpointDiff,
  CreateSessionBody,
  CreateWorkspaceBody,
  Health,
  ImportSessionsBody,
  Model,
  Page,
  Prefs,
  QuotaSnapshot,
  Run,
  SaveAccountBody,
  Session,
  SessionEventEnvelope,
  StartLoginBody,
  SwitchAccountBody,
  TranscriptStep,
  UpdatePrefsBody,
  UpdateSessionBody,
  WhoAmI,
  Workspace,
} from '@agy-studio/contracts';
import { ApiError, getAuthToken, request, type RequestOptions } from './http';

// ---------- Health & Capabilities ----------

export function getHealth(options?: RequestOptions<'GET /api/health'>): Promise<Health> {
  return request('GET /api/health', options as any);
}

export function getCapabilities(options?: RequestOptions<'GET /api/capabilities'>): Promise<Capabilities> {
  return request('GET /api/capabilities', options as any);
}

// ---------- Workspaces ----------

export function getWorkspaces(options?: RequestOptions<'GET /api/workspaces'>): Promise<Workspace[]> {
  return request('GET /api/workspaces', options as any);
}

export function createWorkspace(
  body: CreateWorkspaceBody,
  options?: Omit<RequestOptions<'POST /api/workspaces'>, 'body'>,
): Promise<Workspace> {
  return request('POST /api/workspaces', { ...options, body });
}

export function deleteWorkspace(
  workspaceId: string,
  options?: Omit<RequestOptions<'DELETE /api/workspaces/:workspaceId'>, 'params'>,
): Promise<{ ok: true }> {
  return request('DELETE /api/workspaces/:workspaceId', {
    ...options,
    params: { workspaceId },
  });
}

// ---------- Sessions ----------

export function getSessions(
  query?: ApiEndpoints['GET /api/sessions']['query'],
  options?: Omit<RequestOptions<'GET /api/sessions'>, 'query'>,
): Promise<Page<Session>> {
  return request('GET /api/sessions', { ...options, query } as any);
}

export function createSession(
  body: CreateSessionBody,
  options?: Omit<RequestOptions<'POST /api/sessions'>, 'body'>,
): Promise<Session> {
  return request('POST /api/sessions', { ...options, body });
}

export function getSession(
  sessionId: string,
  options?: Omit<RequestOptions<'GET /api/sessions/:sessionId'>, 'params'>,
): Promise<Session> {
  return request('GET /api/sessions/:sessionId', {
    ...options,
    params: { sessionId },
  });
}

export function updateSession(
  sessionId: string,
  body: UpdateSessionBody,
  options?: Omit<RequestOptions<'PATCH /api/sessions/:sessionId'>, 'params' | 'body'>,
): Promise<Session> {
  return request('PATCH /api/sessions/:sessionId', {
    ...options,
    params: { sessionId },
    body,
  });
}

export function deleteSession(
  sessionId: string,
  query?: ApiEndpoints['DELETE /api/sessions/:sessionId']['query'],
  options?: Omit<RequestOptions<'DELETE /api/sessions/:sessionId'>, 'params' | 'query'>,
): Promise<{ ok: true }> {
  return request('DELETE /api/sessions/:sessionId', {
    ...options,
    params: { sessionId },
    query,
  } as any);
}

export function importSessions(
  body: ImportSessionsBody,
  options?: Omit<RequestOptions<'POST /api/sessions/import'>, 'body'>,
): Promise<{ imported: Session[] }> {
  return request('POST /api/sessions/import', { ...options, body });
}

export function getSessionEvents(
  sessionId: string,
  query?: ApiEndpoints['GET /api/sessions/:sessionId/events']['query'],
  options?: Omit<RequestOptions<'GET /api/sessions/:sessionId/events'>, 'params' | 'query'>,
): Promise<{ items: SessionEventEnvelope[]; latestSeq: number; hasMore: boolean }> {
  return request('GET /api/sessions/:sessionId/events', {
    ...options,
    params: { sessionId },
    query,
  } as any);
}

export function getSessionRuns(
  sessionId: string,
  options?: Omit<RequestOptions<'GET /api/sessions/:sessionId/runs'>, 'params'>,
): Promise<Run[]> {
  return request('GET /api/sessions/:sessionId/runs', {
    ...options,
    params: { sessionId },
  });
}

export function getSubagentTranscript(
  sessionId: string,
  conversationId: string,
  query?: ApiEndpoints['GET /api/sessions/:sessionId/subagents/:conversationId/transcript']['query'],
  options?: Omit<
    RequestOptions<'GET /api/sessions/:sessionId/subagents/:conversationId/transcript'>,
    'params' | 'query'
  >,
): Promise<{ steps: TranscriptStep[]; total: number }> {
  return request('GET /api/sessions/:sessionId/subagents/:conversationId/transcript', {
    ...options,
    params: { sessionId, conversationId },
    query,
  } as any);
}

// ---------- Artifacts ----------

export function getArtifacts(
  sessionId: string,
  options?: Omit<RequestOptions<'GET /api/sessions/:sessionId/artifacts'>, 'params'>,
): Promise<Artifact[]> {
  return request('GET /api/sessions/:sessionId/artifacts', {
    ...options,
    params: { sessionId },
  });
}

export function getArtifactRaw(
  sessionId: string,
  artifactId: string,
  options?: Omit<RequestOptions<'GET /api/sessions/:sessionId/artifacts/:artifactId/raw'>, 'params'>,
): Promise<Blob> {
  return request('GET /api/sessions/:sessionId/artifacts/:artifactId/raw', {
    ...options,
    params: { sessionId, artifactId },
  });
}

// ---------- Checkpoints ----------

export function getCheckpoints(
  sessionId: string,
  options?: Omit<RequestOptions<'GET /api/sessions/:sessionId/checkpoints'>, 'params'>,
): Promise<Checkpoint[]> {
  return request('GET /api/sessions/:sessionId/checkpoints', {
    ...options,
    params: { sessionId },
  });
}

export function getCheckpointDiff(
  checkpointId: string,
  options?: Omit<RequestOptions<'GET /api/checkpoints/:checkpointId/diff'>, 'params'>,
): Promise<CheckpointDiff> {
  return request('GET /api/checkpoints/:checkpointId/diff', {
    ...options,
    params: { checkpointId },
  });
}

export function rollbackCheckpoint(
  checkpointId: string,
  options?: Omit<RequestOptions<'POST /api/checkpoints/:checkpointId/rollback'>, 'params'>,
): Promise<{ ok: true; restoredFiles: number }> {
  return request('POST /api/checkpoints/:checkpointId/rollback', {
    ...options,
    params: { checkpointId },
  });
}

// ---------- Attachments ----------

export function getAttachmentRaw(
  attachmentId: string,
  options?: Omit<RequestOptions<'GET /api/attachments/:attachmentId/raw'>, 'params'>,
): Promise<Blob> {
  return request('GET /api/attachments/:attachmentId/raw', {
    ...options,
    params: { attachmentId },
  });
}

export function postAttachments(
  formData: FormData,
  options?: Omit<RequestOptions<'POST /api/attachments'>, 'body'>,
): Promise<{ attachments: Attachment[] }> {
  return request('POST /api/attachments', {
    ...options,
    body: formData,
  });
}

/**
 * Upload attachments with progress reporting via XMLHttpRequest.
 */
export function uploadAttachments(
  files: File[],
  workspaceId: string,
  sessionId?: string,
  onProgress?: (percent: number) => void,
): Promise<{ attachments: Attachment[] }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('workspaceId', workspaceId);
    if (sessionId) {
      formData.append('sessionId', sessionId);
    }
    for (const file of files) {
      formData.append('files', file);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/attachments');

    const token = getAuthToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      const status = xhr.status;
      if (status >= 200 && status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (onProgress) {
            onProgress(100);
          }
          resolve(data);
        } catch {
          reject(
            new ApiError('INTERNAL', 'Failed to parse response JSON', {
              status,
              retryable: false,
            }),
          );
        }
      } else {
        let code = 'INTERNAL' as const;
        let message = `Upload failed with status ${status}`;
        let retryable = false;
        let details: Record<string, unknown> | undefined;

        try {
          const errorJson = JSON.parse(xhr.responseText);
          if (errorJson && typeof errorJson === 'object' && 'error' in errorJson) {
            const err = errorJson.error;
            if (err.code) code = err.code;
            if (err.message) message = err.message;
            if (typeof err.retryable === 'boolean') retryable = err.retryable;
            if (err.details) details = err.details;
          }
        } catch {
          // ignore json parse error on non-2xx
        }

        reject(
          new ApiError(code, message, {
            status,
            retryable,
            details,
          }),
        );
      }
    };

    xhr.onerror = () => {
      reject(
        new ApiError('INTERNAL', 'Network error', {
          status: 0,
          retryable: true,
        }),
      );
    };

    xhr.ontimeout = () => {
      reject(
        new ApiError('INTERNAL', 'Request timeout', {
          status: 0,
          retryable: true,
        }),
      );
    };

    xhr.onabort = () => {
      reject(
        new ApiError('INTERNAL', 'Request aborted', {
          status: 0,
          retryable: false,
        }),
      );
    };

    xhr.send(formData);
  });
}

// ---------- Models, Prefs, Quota ----------

export function getModels(
  query?: ApiEndpoints['GET /api/models']['query'],
  options?: Omit<RequestOptions<'GET /api/models'>, 'query'>,
): Promise<Model[]> {
  return request('GET /api/models', { ...options, query } as any);
}

export function getPrefs(options?: RequestOptions<'GET /api/prefs'>): Promise<Prefs> {
  return request('GET /api/prefs', options as any);
}

export function updatePrefs(
  body: UpdatePrefsBody,
  options?: Omit<RequestOptions<'PUT /api/prefs'>, 'body'>,
): Promise<Prefs> {
  return request('PUT /api/prefs', { ...options, body });
}

export function getQuota(
  query?: ApiEndpoints['GET /api/quota']['query'],
  options?: Omit<RequestOptions<'GET /api/quota'>, 'query'>,
): Promise<QuotaSnapshot> {
  return request('GET /api/quota', { ...options, query } as any);
}

// ---------- Accounts ----------

export function getAccounts(
  options?: RequestOptions<'GET /api/accounts'>,
): Promise<{ accounts: Account[]; whoami: WhoAmI }> {
  return request('GET /api/accounts', options as any);
}

export function saveAccount(
  body: SaveAccountBody,
  options?: Omit<RequestOptions<'POST /api/accounts/save'>, 'body'>,
): Promise<Account> {
  return request('POST /api/accounts/save', { ...options, body });
}

export function switchAccount(
  body: SwitchAccountBody,
  options?: Omit<RequestOptions<'POST /api/accounts/switch'>, 'body'>,
): Promise<{ whoami: WhoAmI }> {
  return request('POST /api/accounts/switch', { ...options, body });
}

export function deleteAccount(
  name: string,
  options?: Omit<RequestOptions<'DELETE /api/accounts/:name'>, 'params'>,
): Promise<{ ok: true }> {
  return request('DELETE /api/accounts/:name', {
    ...options,
    params: { name },
  });
}

export function startLogin(
  body: StartLoginBody,
  options?: Omit<RequestOptions<'POST /api/accounts/login'>, 'body'>,
): Promise<AccountLoginSession> {
  return request('POST /api/accounts/login', { ...options, body });
}

export function getLoginSession(
  loginId: string,
  options?: Omit<RequestOptions<'GET /api/accounts/login/:loginId'>, 'params'>,
): Promise<AccountLoginSession> {
  return request('GET /api/accounts/login/:loginId', {
    ...options,
    params: { loginId },
  });
}

export function cancelLoginSession(
  loginId: string,
  options?: Omit<RequestOptions<'DELETE /api/accounts/login/:loginId'>, 'params'>,
): Promise<AccountLoginSession> {
  return request('DELETE /api/accounts/login/:loginId', {
    ...options,
    params: { loginId },
  });
}
