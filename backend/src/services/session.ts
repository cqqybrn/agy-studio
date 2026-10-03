import type {
  AgentEvent,
  AgentMode,
  CreateSessionBody,
  Effort,
  ImportSessionsBody,
  Page,
  Run,
  Session,
  SessionEventEnvelope,
  UpdateSessionBody,
} from '@agy-studio/contracts';
import type { SessionsRepository } from '../repositories/sessions.js';
import type { WorkspacesRepository } from '../repositories/workspaces.js';
import type { RunsRepository } from '../repositories/runs.js';
import type { EventsRepository } from '../repositories/events.js';
import type { AttachmentsRepository } from '../repositories/attachments.js';
import type { AccountsRepository } from '../repositories/accounts.js';
import type { EventBus } from './event-bus.js';
import type { RunSupervisor } from './run-supervisor.js';
import type { BrainPort } from './ports/brain.port.js';
import type { HomeIsolationPort } from './ports/home-isolation.port.js';
import { AppError } from '../utils/errors.js';
import { createId } from '../utils/ids.js';
import type { SessionServicePort } from '../routes/ws/gateway.js';
import { PromptInjector } from './attachment/prompt-inject.js';
import type { ImageInputProfile } from './ports/agy-runner.port.js';
import { isBuiltinAgent, isSafeAgentName, type AgentService } from './agent.js';

export interface SendMessageInput {
  sessionId: string;
  text: string;
  attachmentIds: string[];
  model?: string;
  effort?: Effort;
  mode?: AgentMode;
  agent?: string;
}

export interface SessionServiceOptions {
  sessionsRepo: SessionsRepository;
  workspacesRepo: WorkspacesRepository;
  runsRepo: RunsRepository;
  eventsRepo: EventsRepository;
  attachmentsRepo?: AttachmentsRepository;
  accountsRepo?: AccountsRepository;
  eventBus: EventBus;
  supervisor: RunSupervisor;
  brainPort?: BrainPort;
  homeIsolation?: HomeIsolationPort;
  isolationMode?: 'isolated_home' | 'credential_snapshot';
  promptInjector?: PromptInjector;
  profile?: ImageInputProfile;
  agentService?: AgentService;
}

export class SessionService implements SessionServicePort {
  private readonly sessionsRepo: SessionsRepository;
  private readonly workspacesRepo: WorkspacesRepository;
  private readonly runsRepo: RunsRepository;
  private readonly eventsRepo: EventsRepository;
  private readonly attachmentsRepo?: AttachmentsRepository;
  private readonly accountsRepo?: AccountsRepository;
  private readonly eventBus: EventBus;
  private readonly supervisor: RunSupervisor;
  private readonly brainPort?: BrainPort;
  private readonly homeIsolation?: HomeIsolationPort;
  private readonly isolationMode: 'isolated_home' | 'credential_snapshot';
  private readonly promptInjector: PromptInjector;
  private readonly profile?: ImageInputProfile;
  private readonly agentService?: AgentService;

  constructor(options: SessionServiceOptions) {
    this.sessionsRepo = options.sessionsRepo;
    this.workspacesRepo = options.workspacesRepo;
    this.runsRepo = options.runsRepo;
    this.eventsRepo = options.eventsRepo;
    this.attachmentsRepo = options.attachmentsRepo;
    this.accountsRepo = options.accountsRepo;
    this.eventBus = options.eventBus;
    this.supervisor = options.supervisor;
    this.brainPort = options.brainPort;
    this.homeIsolation = options.homeIsolation;
    this.isolationMode = options.isolationMode ?? 'isolated_home';
    this.promptInjector = options.promptInjector ?? new PromptInjector();
    this.profile = options.profile;
    this.agentService = options.agentService;
  }

  /**
   * Retrieves active run ID for a given session, matching SessionServicePort in gateway.ts.
   */
  getActiveRunId(sessionId: string): string | null {
    const active = this.supervisor.getActiveRunBySessionId(sessionId);
    return active ? active.id : null;
  }

  /**
   * Aborts an active run, matching SessionServicePort in gateway.ts.
   */
  async abortRun(params: { runId: string }): Promise<void> {
    await this.abort(params.runId);
  }

  async abort(runId: string): Promise<void> {
    const aborted = await this.supervisor.abort(runId);
    if (!aborted) {
      const run = this.runsRepo.findById(runId);
      if (!run) {
        throw new AppError('NOT_FOUND', `Run ${runId} not found`);
      }
    }
  }

  async createSession(input: CreateSessionBody): Promise<Session> {
    const workspace = this.workspacesRepo.findById(input.workspaceId);
    if (!workspace) {
      throw new AppError('NOT_FOUND', `Workspace ${input.workspaceId} not found`);
    }

    let accountName: string | null = null;
    if (this.isolationMode === 'isolated_home') {
      if (input.accountName) {
        accountName = input.accountName;
      } else if (this.accountsRepo) {
        const defaultAcc = this.accountsRepo.findDefault();
        accountName = defaultAcc ? defaultAcc.name : null;
      }
    } else {
      // In credential_snapshot mode, accountName is null on session creation
      accountName = null;
    }

    const now = new Date().toISOString();
    const session: Session = {
      id: createId('session'),
      workspaceId: input.workspaceId,
      title: input.title?.trim() || 'New Session',
      agyConversationId: null,
      status: 'idle',
      model: input.model ?? null,
      effort: input.effort ?? null,
      mode: input.mode ?? null,
      source: 'studio',
      accountName,
      lastRunId: null,
      lastSeq: 0,
      createdAt: now,
      updatedAt: now,
    };

    const created = this.sessionsRepo.create(session);
    this.eventBus.publishGlobal({
      type: 'session.upserted',
      session: created,
    });

    return created;
  }

  async listSessions(query: {
    workspaceId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Page<Session>> {
    return this.sessionsRepo.list(query);
  }

  async getSession(sessionId: string): Promise<Session> {
    const session = this.sessionsRepo.findById(sessionId);
    if (!session) {
      throw new AppError('NOT_FOUND', `Session ${sessionId} not found`);
    }
    return session;
  }

  async updateSession(sessionId: string, input: UpdateSessionBody): Promise<Session> {
    const session = this.sessionsRepo.findById(sessionId);
    if (!session) {
      throw new AppError('NOT_FOUND', `Session ${sessionId} not found`);
    }

    const patch: Partial<Session> = {};
    if (input.title !== undefined) {
      patch.title = input.title;
    }
    if (input.model !== undefined) {
      patch.model = input.model;
    }
    if (input.effort !== undefined) {
      patch.effort = input.effort;
    }
    if (input.mode !== undefined) {
      patch.mode = input.mode;
    }

    const updated = this.sessionsRepo.update(sessionId, patch);
    if (!updated) {
      throw new AppError('NOT_FOUND', `Session ${sessionId} not found`);
    }

    this.eventBus.publishGlobal({
      type: 'session.upserted',
      session: updated,
    });

    return updated;
  }

  async deleteSession(sessionId: string, purge = false): Promise<void> {
    const session = this.sessionsRepo.findById(sessionId);
    if (!session) {
      throw new AppError('NOT_FOUND', `Session ${sessionId} not found`);
    }

    // 运行中（supervisor.activeRuns 中包含该会话或状态为 running 等）抛出 AppError('SESSION_BUSY')
    const active = this.supervisor.getActiveRunBySessionId(sessionId);
    if (active || session.status === 'running') {
      throw new AppError('SESSION_BUSY', `Session ${sessionId} has an active run`);
    }

    // purge=true 时通过注入的 BrainPort.purgeConversation 清理该会话磁盘文件（如果存在 agyConversationId）
    if (purge && session.agyConversationId && this.brainPort) {
      let dataRoot: string | undefined;
      if (this.isolationMode === 'isolated_home' && session.accountName && this.homeIsolation) {
        dataRoot = this.homeIsolation.getHomePath(session.accountName);
      }
      try {
        await this.brainPort.purgeConversation(session.agyConversationId, dataRoot);
      } catch {
        // Purge failures must not block deleting the session from the repo
      }
    }

    this.sessionsRepo.delete(sessionId);
    this.eventBus.publishGlobal({
      type: 'session.deleted',
      sessionId,
    });
  }

  async send(params: SendMessageInput): Promise<{ runId: string }> {
    const { sessionId, text, attachmentIds, model, effort, mode } = params;

    const session = this.sessionsRepo.findById(sessionId);
    if (!session) {
      throw new AppError('NOT_FOUND', `Session ${sessionId} not found`);
    }

    const workspace = this.workspacesRepo.findById(session.workspaceId);
    if (!workspace) {
      throw new AppError('NOT_FOUND', `Workspace ${session.workspaceId} not found`);
    }

    const agent = await this.resolveAgent(params.agent, workspace.path);

    // 标题处理：如果会话标题为默认（或首条消息），取首条消息前 50 字符更新标题
    const isDefaultTitle = session.title === 'New Session' || session.title === 'Untitled' || !session.title;
    if (isDefaultTitle) {
      const trimmed = text.replace(/[\r\n]+/g, ' ').trim();
      const newTitle = trimmed.slice(0, 50) || 'New Session';
      session.title = newTitle;
      this.sessionsRepo.update(sessionId, { title: newTitle });
    }

    // 查询附件
    const attachments =
      this.attachmentsRepo && attachmentIds && attachmentIds.length > 0
        ? this.attachmentsRepo.findByIds(attachmentIds)
        : [];

    // 发布 user.message 事件到 eventBus (携带 messageId, text, attachments)
    const userMessageEvent: AgentEvent = {
      type: 'user.message',
      messageId: createId('msg'),
      text,
      attachments,
    };
    await this.eventBus.publish(sessionId, null, userMessageEvent);

    // 如果存在附件，使用 promptInjector 对 prompt 进行修饰并传入 supervisor
    let effectivePrompt = text;
    if (attachments.length > 0) {
      const injected = this.promptInjector.injectAttachments(text, attachments, this.profile);
      effectivePrompt = injected.prompt;
    }

    // 启动运行：调用 supervisor.start(sessionId, { prompt: effectivePrompt, cwd: workspace.path, accountName: session.accountName, model, effort, mode, agent })
    const runResult = await this.supervisor.start(sessionId, {
      prompt: effectivePrompt,
      cwd: workspace.path,
      accountName: session.accountName,
      model: model ?? session.model,
      effort: effort ?? session.effort,
      mode: mode ?? session.mode,
      ...(agent ? { agent } : {}),
    });

    const runId = runResult.runId;

    // 监听 supervisor 的输出事件：
    // * 首次收到包含 conversationId 的事件（如 init 或 step 或 run.completed）时，回填 sessions.agy_conversation_id
    // * 运行结束时更新 session 状态并发布全局事件 publishGlobal({ type: 'session.upserted', session })
    let backfilled = Boolean(session.agyConversationId);

    const cleanupListener = this.supervisor.addEventListener(async (sId, rId, event) => {
      if (sId !== sessionId || rId !== runId) return;

      if (!backfilled) {
        let conversationId: string | null = null;
        if (event.type === 'run.completed' && event.agyConversationId) {
          conversationId = event.agyConversationId;
        } else if (event.type === 'raw' && event.payload && typeof event.payload === 'object') {
          const payload = event.payload as { conversationId?: unknown; conversation_id?: unknown };
          const id = payload.conversationId || payload.conversation_id;
          conversationId = typeof id === 'string' ? id : null;
        }

        if (conversationId) {
          backfilled = true;
          this.sessionsRepo.update(sessionId, { agyConversationId: conversationId });
          const cur = this.sessionsRepo.findById(sessionId);
          if (cur) {
            this.eventBus.publishGlobal({
              type: 'session.upserted',
              session: cur,
            });
          }
        }
      }
    });

    // 监听 completion 保证完成时的状态同步与全局事件广播
    runResult.completion.then(() => {
      cleanupListener();
      const updatedSession = this.sessionsRepo.findById(sessionId);
      if (updatedSession) {
        this.eventBus.publishGlobal({
          type: 'session.upserted',
          session: updatedSession,
        });
      }
    }).catch(() => {
      cleanupListener();
    });

    return { runId };
  }

  private async resolveAgent(
    agent: string | undefined,
    workspaceDir: string,
  ): Promise<string | undefined> {
    if (this.agentService) {
      return this.agentService.resolveAgentArg(agent, workspaceDir);
    }
    if (isBuiltinAgent(agent)) return undefined;
    const name = agent!.trim();
    if (isSafeAgentName(name)) return name;
    throw new AppError('BAD_REQUEST', `Unknown or invalid agent "${name}"`, {
      details: { agent: name },
    });
  }

  async importSessions(input: ImportSessionsBody): Promise<{ imported: Session[] }> {
    const workspace = this.workspacesRepo.findById(input.workspaceId);
    if (!workspace) {
      throw new AppError('NOT_FOUND', `Workspace ${input.workspaceId} not found`);
    }

    if (!this.brainPort) {
      return { imported: [] };
    }

    // 确定要扫描的数据根列表与对应的账号名称
    const scanTargets: Array<{ accountName: string | null; dataRoot?: string }> = [];

    if (this.isolationMode === 'isolated_home' && this.homeIsolation && this.accountsRepo) {
      const accounts = this.accountsRepo.list();
      if (accounts.length > 0) {
        for (const acc of accounts) {
          const homePath = this.homeIsolation.getHomePath(acc.name);
          scanTargets.push({ accountName: acc.name, dataRoot: homePath });
        }
      } else {
        scanTargets.push({ accountName: null, dataRoot: undefined });
      }
    } else {
      const defaultAcc = this.accountsRepo?.findDefault();
      scanTargets.push({ accountName: defaultAcc?.name ?? null, dataRoot: undefined });
    }

    const imported: Session[] = [];
    const filterIds = input.agyConversationIds ? new Set(input.agyConversationIds) : null;

    for (const target of scanTargets) {
      let conversations: Array<{ id: string; title: string; createdAt: string; updatedAt: string }> = [];
      try {
        conversations = await this.brainPort.listConversations(target.dataRoot);
      } catch {
        continue;
      }

      for (const conv of conversations) {
        if (filterIds && !filterIds.has(conv.id)) {
          continue;
        }

        // 排除已在 sessions 表中 agyConversationId 存在的
        const existing = this.sessionsRepo.findByAgyConversationId(conv.id);
        if (existing) {
          continue;
        }

        const now = new Date().toISOString();
        const sessionId = createId('session');

        // 读取 transcript 转成事件写入 events 表
        const envelopes: SessionEventEnvelope[] = [];
        let seq = 1;

        try {
          const handle = await this.brainPort.tailTranscript(conv.id, undefined, target.dataRoot);
          for await (const step of handle.steps) {
            // 将 transcript step 转换为事件
            const text = step.content || '';
            const isUser = step.type.toLowerCase().includes('user');

            if (isUser) {
              envelopes.push({
                seq: seq++,
                sessionId,
                runId: null,
                ts: step.createdAt || now,
                event: {
                  type: 'user.message',
                  messageId: createId('msg'),
                  text,
                  attachments: [],
                },
              });
            } else if (step.thinking) {
              envelopes.push({
                seq: seq++,
                sessionId,
                runId: null,
                ts: step.createdAt || now,
                event: {
                  type: 'thinking.delta',
                  blockId: `thinking-${conv.id}-${step.stepIndex}`,
                  source: 'transcript',
                  text: step.thinking,
                },
              });
            } else if (text) {
              envelopes.push({
                seq: seq++,
                sessionId,
                runId: null,
                ts: step.createdAt || now,
                event: {
                  type: 'message.delta',
                  messageId: `msg-${step.stepIndex}`,
                  text,
                },
              });
            }
          }
          handle.stop();
        } catch {
          // ignore error reading transcript
        }

        const sessionRecord: Session = {
          id: sessionId,
          workspaceId: input.workspaceId,
          title: conv.title || 'Imported Session',
          agyConversationId: conv.id,
          status: 'idle',
          model: null,
          effort: null,
          mode: null,
          source: 'imported',
          accountName: target.accountName,
          lastRunId: null,
          lastSeq: envelopes.length,
          createdAt: conv.createdAt || now,
          updatedAt: conv.updatedAt || now,
        };

        const created = this.sessionsRepo.create(sessionRecord);

        if (envelopes.length > 0) {
          this.eventsRepo.appendBatch(sessionId, envelopes);
        }

        imported.push(created);

        this.eventBus.publishGlobal({
          type: 'session.upserted',
          session: created,
        });
      }
    }

    return { imported };
  }

  async listEvents(
    sessionId: string,
    afterSeq?: number,
    limit?: number,
  ): Promise<{ items: SessionEventEnvelope[]; latestSeq: number; hasMore: boolean }> {
    const session = this.sessionsRepo.findById(sessionId);
    if (!session) {
      throw new AppError('NOT_FOUND', `Session ${sessionId} not found`);
    }

    const curAfterSeq = afterSeq ?? 0;
    const curLimit = Math.max(1, Math.min(limit ?? 100, 500));

    // Fetch curLimit + 1 to know if there's more
    const items = this.eventsRepo.listAfter(sessionId, curAfterSeq, curLimit + 1);
    const hasMore = items.length > curLimit;
    const returnItems = hasMore ? items.slice(0, curLimit) : items;
    const latestSeq = this.eventsRepo.latestSeq(sessionId);

    return {
      items: returnItems,
      latestSeq,
      hasMore,
    };
  }

  async listRuns(sessionId: string): Promise<Run[]> {
    const session = this.sessionsRepo.findById(sessionId);
    if (!session) {
      throw new AppError('NOT_FOUND', `Session ${sessionId} not found`);
    }

    return this.runsRepo.listBySessionId(sessionId);
  }
}
