import fs from 'node:fs';
import path from 'node:path';
import type { AgentEvent, TranscriptStep } from '@agy-studio/contracts';
import type { SessionsRepository } from '../repositories/sessions.js';
import type { EventsRepository } from '../repositories/events.js';
import type { BrainPort } from './ports/brain.port.js';
import type { HomeIsolationPort } from './ports/home-isolation.port.js';
import type { SupervisorEventListener } from './run-supervisor.js';
import { AppError } from '../utils/errors.js';
import { isUuid } from '../utils/ids.js';

export interface SubagentTranscriptServiceOptions {
  brainPort: BrainPort;
  sessionsRepo: SessionsRepository;
  eventsRepo?: EventsRepository;
  /** Records subagents as they spawn, so long sessions do not depend on the event-history scan. */
  supervisor?: {
    addEventListener(listener: SupervisorEventListener): () => void;
  };
  homeIsolation?: HomeIsolationPort;
  isolationMode?: 'isolated_home' | 'credential_snapshot';
  resolveConversationDir?: (
    conversationId: string,
    options?: { dataRoot?: string; homeDir?: string },
  ) => string;
}

export interface SubagentTranscriptResult {
  steps: TranscriptStep[];
  total: number;
}

/**
 * Serves the steps of a subagent conversation (shown when a subagent card is expanded).
 * A conversation is only readable through the session that spawned it.
 */
export class SubagentTranscriptService {
  private readonly brainPort: BrainPort;
  private readonly sessionsRepo: SessionsRepository;
  private readonly eventsRepo?: EventsRepository;
  private readonly homeIsolation?: HomeIsolationPort;
  private readonly isolationMode: 'isolated_home' | 'credential_snapshot';
  private readonly resolveConversationDirFn?: SubagentTranscriptServiceOptions['resolveConversationDir'];
  private unsubscribeSupervisor?: () => void;

  // sessionId -> Set of subagent conversationIds
  private readonly sessionSubagents = new Map<string, Set<string>>();

  constructor(options: SubagentTranscriptServiceOptions) {
    this.brainPort = options.brainPort;
    this.sessionsRepo = options.sessionsRepo;
    this.eventsRepo = options.eventsRepo;
    this.homeIsolation = options.homeIsolation;
    this.isolationMode = options.isolationMode ?? 'credential_snapshot';
    this.resolveConversationDirFn = options.resolveConversationDir;

    this.unsubscribeSupervisor = options.supervisor?.addEventListener(
      (sessionId: string, _runId: string, event: AgentEvent) => {
        if (event.type === 'subagent.spawned') {
          this.recordSubagent(sessionId, event.subagent.conversationId);
        }
      },
    );
  }

  /**
   * Records a spawned subagent conversation for a session.
   */
  recordSubagent(sessionId: string, conversationId: string): void {
    let subagents = this.sessionSubagents.get(sessionId);
    if (!subagents) {
      subagents = new Set<string>();
      this.sessionSubagents.set(sessionId, subagents);
    }
    subagents.add(conversationId);
  }

  /**
   * Checks whether a conversationId belongs to the session as a subagent.
   */
  isSubagentOfSession(sessionId: string, conversationId: string): boolean {
    if (this.sessionSubagents.get(sessionId)?.has(conversationId)) {
      return true;
    }

    if (this.eventsRepo) {
      try {
        const envelopes = this.eventsRepo.listAfter(sessionId, 0, 1000);
        for (const env of envelopes) {
          if (
            env.event.type === 'subagent.spawned' &&
            env.event.subagent.conversationId === conversationId
          ) {
            this.recordSubagent(sessionId, conversationId);
            return true;
          }
        }
      } catch {
        // ignore
      }
    }

    return false;
  }

  private resolveConversationDir(
    conversationId: string,
    options?: { dataRoot?: string; homeDir?: string },
  ): string {
    if (this.resolveConversationDirFn) {
      return this.resolveConversationDirFn(conversationId, options);
    }
    if (typeof this.brainPort.resolveConversationDir === 'function') {
      return this.brainPort.resolveConversationDir(conversationId, options);
    }
    throw new AppError('INTERNAL', 'Unable to resolve conversation directory');
  }

  /**
   * Retrieves subagent transcript with pagination support.
   */
  async getSubagentTranscript(
    sessionId: string,
    conversationId: string,
    query?: { afterStep?: number; limit?: number },
  ): Promise<SubagentTranscriptResult> {
    if (!isUuid(conversationId)) {
      throw new AppError('BAD_REQUEST', 'Invalid conversation ID: must be a valid UUID');
    }

    const session = this.sessionsRepo.findById(sessionId);
    if (!session) {
      throw new AppError('NOT_FOUND', `Session ${sessionId} not found`);
    }

    const isMain = session.agyConversationId === conversationId;
    const isSubagent = this.isSubagentOfSession(sessionId, conversationId);
    if (!isMain && !isSubagent) {
      throw new AppError(
        'NOT_FOUND',
        `Conversation ${conversationId} is not associated with session ${sessionId}`,
      );
    }

    let dataRoot: string | undefined;
    if (this.isolationMode === 'isolated_home' && session.accountName && this.homeIsolation) {
      dataRoot = this.homeIsolation.getHomePath(session.accountName);
    }

    const allSteps: TranscriptStep[] = [];
    let readFromDiskSuccess = false;

    // 1. Try reading directly from transcript.jsonl if conversation directory is resolved
    try {
      const convDir = this.resolveConversationDir(conversationId, { dataRoot });
      const candidatePaths = [
        path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl'),
        path.join(convDir, 'transcript.jsonl'),
      ];

      for (const cand of candidatePaths) {
        if (fs.existsSync(cand)) {
          const content = await fs.promises.readFile(cand, 'utf-8');
          const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line.trim());
              if (parsed && typeof parsed === 'object') {
                allSteps.push({
                  stepIndex:
                    parsed.stepIndex ?? parsed.step_index ?? parsed.index ?? allSteps.length,
                  type: parsed.type ?? parsed.step_type ?? parsed.kind ?? 'unknown',
                  status: parsed.status ?? null,
                  createdAt: parsed.createdAt ?? parsed.created_at ?? null,
                  content: parsed.content ?? null,
                  thinking: parsed.thinking ?? null,
                  toolCalls: parsed.toolCalls ?? parsed.tool_calls ?? [],
                  error: parsed.error ?? null,
                });
              }
            } catch {
              // skip malformed line
            }
          }
          readFromDiskSuccess = true;
          break;
        }
      }
    } catch {
      // fallback to brainPort.tailTranscript
    }

    // 2. If not read from disk, use brainPort.tailTranscript
    if (!readFromDiskSuccess) {
      const handle = await this.brainPort.tailTranscript(conversationId, { fromStep: 0 }, dataRoot);
      try {
        for await (const step of handle.steps) {
          allSteps.push(step);
        }
      } catch {
        // tail ended
      } finally {
        handle.stop();
      }
    }

    allSteps.sort((a, b) => a.stepIndex - b.stepIndex);
    const total = allSteps.length;
    let filtered = allSteps;

    if (query?.afterStep !== undefined) {
      filtered = filtered.filter((s) => s.stepIndex > query.afterStep!);
    }

    const limit = query?.limit !== undefined ? Math.max(1, query.limit) : undefined;
    const paged = limit !== undefined ? filtered.slice(0, limit) : filtered;

    return {
      steps: paged,
      total,
    };
  }

  dispose(): void {
    this.unsubscribeSupervisor?.();
    this.unsubscribeSupervisor = undefined;
  }
}
