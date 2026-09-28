import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentEvent,
  Artifact,
  TranscriptStep,
} from '@agy-studio/contracts';
import type { SessionsRepository } from '../repositories/sessions.js';
import type { EventsRepository } from '../repositories/events.js';
import type { EventBus } from './event-bus.js';
import type { ArtifactWatchHandle, BrainPort } from './ports/brain.port.js';
import type { HomeIsolationPort } from './ports/home-isolation.port.js';
import type { SupervisorEventListener } from './run-supervisor.js';
import { AppError } from '../utils/errors.js';
import { isUuid } from '../utils/ids.js';

export interface ArtifactLogger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  warn?(obj: unknown, msg?: string): void;
  debug?(obj: unknown, msg?: string): void;
}

export interface ArtifactServiceOptions {
  brainPort: BrainPort;
  sessionsRepo: SessionsRepository;
  eventBus: EventBus;
  supervisor: {
    addEventListener(listener: SupervisorEventListener): () => void;
  };
  logger?: ArtifactLogger;
  homeIsolation?: HomeIsolationPort;
  isolationMode?: 'isolated_home' | 'credential_snapshot';
  debounceMs?: number;
  cleanupDelayMs?: number;
  resolveConversationDir?: (
    conversationId: string,
    options?: { dataRoot?: string; homeDir?: string },
  ) => string;
  eventsRepo?: EventsRepository;
}

export interface RawArtifactResult {
  stream: NodeJS.ReadableStream | Buffer;
  mimeType: string;
  fileName: string;
  isSvg: boolean;
}

export interface SubagentTranscriptResult {
  steps: TranscriptStep[];
  total: number;
}

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.json':
      return 'application/json';
    case '.md':
    case '.markdown':
      return 'text/markdown';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.txt':
      return 'text/plain';
    case '.svg':
      return 'image/svg+xml';
    case '.pdf':
      return 'application/pdf';
    case '.html':
    case '.htm':
      return 'text/html';
    default:
      return 'application/octet-stream';
  }
}

export class ArtifactService {
  private readonly brainPort: BrainPort;
  private readonly sessionsRepo: SessionsRepository;
  private readonly eventBus: EventBus;
  private readonly supervisor: {
    addEventListener(listener: SupervisorEventListener): () => void;
  };
  private readonly logger?: ArtifactLogger;
  private readonly homeIsolation?: HomeIsolationPort;
  private readonly isolationMode: 'isolated_home' | 'credential_snapshot';
  private readonly debounceMs: number;
  private readonly cleanupDelayMs: number;
  private readonly resolveConversationDirFn?: (
    conversationId: string,
    options?: { dataRoot?: string; homeDir?: string },
  ) => string;
  private readonly eventsRepo?: EventsRepository;

  private unsubscribeSupervisor?: () => void;

  // runId -> conversationId -> ArtifactWatchHandle
  private readonly runWatches = new Map<string, Map<string, ArtifactWatchHandle>>();
  // runId -> cleanup setTimeout
  private readonly cleanupTimers = new Map<string, NodeJS.Timeout>();
  // artifactId -> debounce setTimeout
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  // artifactId -> latest Artifact
  private readonly artifactCache = new Map<string, Artifact>();
  // sessionId -> Set of subagent conversationIds
  private readonly sessionSubagents = new Map<string, Set<string>>();

  constructor(options: ArtifactServiceOptions) {
    this.brainPort = options.brainPort;
    this.sessionsRepo = options.sessionsRepo;
    this.eventBus = options.eventBus;
    this.supervisor = options.supervisor;
    this.logger = options.logger;
    this.homeIsolation = options.homeIsolation;
    this.isolationMode = options.isolationMode ?? 'credential_snapshot';
    this.debounceMs = options.debounceMs ?? 300;
    this.cleanupDelayMs = options.cleanupDelayMs ?? 5000;
    this.resolveConversationDirFn = options.resolveConversationDir;
    this.eventsRepo = options.eventsRepo;

    this.unsubscribeSupervisor = this.supervisor.addEventListener(
      this.handleSupervisorEvent.bind(this),
    );
  }

  /**
   * Internal supervisor event handler.
   */
  private async handleSupervisorEvent(
    sessionId: string,
    runId: string,
    event: AgentEvent,
  ): Promise<void> {
    if (event.type === 'run.started') {
      const session = this.sessionsRepo.findById(sessionId);
      if (session?.agyConversationId) {
        await this.watchConversation(sessionId, runId, session.agyConversationId);
      }
    } else if (event.type === 'subagent.spawned') {
      const subConvId = event.subagent.conversationId;
      this.recordSubagent(sessionId, subConvId);
      await this.watchConversation(sessionId, runId, subConvId);
    } else if (event.type === 'run.completed') {
      // If session had agyConversationId backfilled in run.completed, ensure watched if needed
      if (event.agyConversationId) {
        const session = this.sessionsRepo.findById(sessionId);
        if (session && !session.agyConversationId) {
          try {
            this.sessionsRepo.update(sessionId, { agyConversationId: event.agyConversationId });
          } catch {
            // ignore
          }
        }
      }

      // Schedule cleanup in 5 seconds
      const existingCleanup = this.cleanupTimers.get(runId);
      if (existingCleanup) {
        clearTimeout(existingCleanup);
      }
      const timer = setTimeout(() => {
        this.cleanupRunWatches(runId);
      }, this.cleanupDelayMs);
      this.cleanupTimers.set(runId, timer);
    } else {
      // Fallback check: if main conversation was not yet watched when run.started fired
      const runMap = this.runWatches.get(runId);
      const session = this.sessionsRepo.findById(sessionId);
      if (session?.agyConversationId && (!runMap || !runMap.has(session.agyConversationId))) {
        await this.watchConversation(sessionId, runId, session.agyConversationId);
      }
    }
  }

  /**
   * Starts watching artifacts for a conversation (main or subagent) during a run.
   */
  async watchConversation(
    sessionId: string,
    runId: string,
    conversationId: string,
  ): Promise<void> {
    let runMap = this.runWatches.get(runId);
    if (!runMap) {
      runMap = new Map<string, ArtifactWatchHandle>();
      this.runWatches.set(runId, runMap);
    }

    if (runMap.has(conversationId)) {
      return;
    }

    const session = this.sessionsRepo.findById(sessionId);
    let dataRoot: string | undefined;
    if (this.isolationMode === 'isolated_home' && session?.accountName && this.homeIsolation) {
      dataRoot = this.homeIsolation.getHomePath(session.accountName);
    }

    try {
      const handle = await this.brainPort.watchArtifacts(
        conversationId,
        sessionId,
        (artifact) => {
          this.handleArtifactChange(sessionId, runId, conversationId, artifact);
        },
        dataRoot,
      );
      runMap.set(conversationId, handle);
    } catch (err) {
      this.logger?.error({ err, sessionId, runId, conversationId }, 'Failed to watch artifacts');
    }
  }

  /**
   * Handles artifact change notification from brainPort with 300ms debounce.
   */
  private handleArtifactChange(
    sessionId: string,
    runId: string,
    conversationId: string,
    artifact: Artifact,
  ): void {
    const id =
      artifact.id ||
      Buffer.from(`${conversationId}/${artifact.relativePath}`, 'utf8').toString('base64url');

    const cached = this.artifactCache.get(id);
    const version = cached ? cached.version + 1 : (artifact.version ?? 1);
    const updatedArtifact: Artifact = {
      ...artifact,
      id,
      sessionId,
      conversationId,
      version,
    };
    this.artifactCache.set(id, updatedArtifact);

    const existingTimer = this.debounceTimers.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(id);
      const latest = this.artifactCache.get(id) ?? updatedArtifact;
      try {
        await this.eventBus.publish(sessionId, runId, {
          type: 'artifact.updated',
          artifact: latest,
        });
      } catch (err) {
        this.logger?.error(
          { err, sessionId, runId, artifactId: id },
          'Failed to publish artifact.updated event',
        );
      }
    }, this.debounceMs);

    this.debounceTimers.set(id, timer);
  }

  /**
   * Releases watch handles for a completed run.
   */
  private cleanupRunWatches(runId: string): void {
    const timer = this.cleanupTimers.get(runId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(runId);
    }

    const handles = this.runWatches.get(runId);
    if (handles) {
      for (const handle of handles.values()) {
        try {
          handle.stop();
        } catch (err) {
          this.logger?.error({ err, runId }, 'Error stopping artifact watch handle');
        }
      }
      this.runWatches.delete(runId);
    }
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

  /**
   * Returns all known subagent conversation IDs for a session.
   */
  getSubagentConversationIds(sessionId: string): string[] {
    const ids = new Set<string>(this.sessionSubagents.get(sessionId) ?? []);
    if (this.eventsRepo) {
      try {
        const envelopes = this.eventsRepo.listAfter(sessionId, 0, 1000);
        for (const env of envelopes) {
          if (env.event.type === 'subagent.spawned') {
            ids.add(env.event.subagent.conversationId);
            this.recordSubagent(sessionId, env.event.subagent.conversationId);
          }
        }
      } catch {
        // ignore
      }
    }
    return Array.from(ids);
  }

  /**
   * Resolves the conversation directory path.
   */
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
   * Lists artifacts for a session (main conversation and any subagents).
   */
  async listArtifacts(sessionId: string): Promise<Artifact[]> {
    const session = this.sessionsRepo.findById(sessionId);
    if (!session) {
      throw new AppError('NOT_FOUND', `Session ${sessionId} not found`);
    }
    if (!session.agyConversationId) {
      return [];
    }

    let dataRoot: string | undefined;
    if (this.isolationMode === 'isolated_home' && session.accountName && this.homeIsolation) {
      dataRoot = this.homeIsolation.getHomePath(session.accountName);
    }

    const artifacts: Artifact[] = [];
    const seenIds = new Set<string>();

    // 1. List main conversation artifacts
    try {
      const mainList = await this.brainPort.listArtifacts(
        session.agyConversationId,
        sessionId,
        dataRoot,
      );
      for (const item of mainList) {
        const id =
          item.id ||
          Buffer.from(`${item.conversationId}/${item.relativePath}`, 'utf8').toString('base64url');
        const cached = this.artifactCache.get(id);
        const finalArtifact: Artifact = cached ? { ...item, ...cached } : { ...item, id };
        artifacts.push(finalArtifact);
        seenIds.add(id);
      }
    } catch (err) {
      this.logger?.warn?.({ err, sessionId }, 'Failed to list main conversation artifacts');
    }

    // 2. List subagents artifacts
    const subagentConvIds = this.getSubagentConversationIds(sessionId);
    for (const subConvId of subagentConvIds) {
      try {
        const subList = await this.brainPort.listArtifacts(subConvId, sessionId, dataRoot);
        for (const item of subList) {
          const id =
            item.id ||
            Buffer.from(`${item.conversationId}/${item.relativePath}`, 'utf8').toString('base64url');
          if (!seenIds.has(id)) {
            const cached = this.artifactCache.get(id);
            const finalArtifact: Artifact = cached ? { ...item, ...cached } : { ...item, id };
            artifacts.push(finalArtifact);
            seenIds.add(id);
          }
        }
      } catch {
        // subagent directory might not exist yet
      }
    }

    return artifacts;
  }

  /**
   * Fetches raw artifact content with strict path traversal & symlink checks.
   */
  async getArtifactRaw(sessionId: string, artifactId: string): Promise<RawArtifactResult> {
    if (!artifactId || typeof artifactId !== 'string') {
      throw new AppError('BAD_REQUEST', 'Artifact ID is required');
    }

    // 1. Decode artifactId
    let decoded: string;
    try {
      decoded = Buffer.from(artifactId, 'base64url').toString('utf8');
    } catch {
      throw new AppError('BAD_REQUEST', 'Invalid base64url artifact ID');
    }

    const slashIdx = decoded.indexOf('/');
    if (slashIdx <= 0 || slashIdx === decoded.length - 1) {
      throw new AppError('BAD_REQUEST', 'Invalid artifact ID structure');
    }

    const conversationId = decoded.slice(0, slashIdx);
    const relativePath = decoded.slice(slashIdx + 1);

    // 2. Strict Security Checks:
    // (1) conversationId must be a valid UUID
    if (!isUuid(conversationId)) {
      throw new AppError('BAD_REQUEST', 'Invalid conversation ID in artifact ID');
    }

    // (2) relativePath rejects '..', null bytes, illegal characters, absolute path
    const normalizedRel = relativePath.replace(/\\/g, '/');
    if (
      normalizedRel.includes('..') ||
      normalizedRel.split('/').some((segment) => segment === '..')
    ) {
      throw new AppError('PATH_OUTSIDE_WORKSPACE', 'Directory traversal is forbidden');
    }

    if (
      path.isAbsolute(relativePath) ||
      relativePath.startsWith('/') ||
      relativePath.startsWith('\\') ||
      /^[A-Za-z]:/.test(relativePath)
    ) {
      throw new AppError('PATH_OUTSIDE_WORKSPACE', 'Absolute paths are forbidden');
    }

    if (relativePath.includes('\0') || /[\0<>:"|?*]/.test(path.basename(relativePath))) {
      throw new AppError('BAD_REQUEST', 'Invalid characters in artifact path');
    }

    // (3) Query session: conversationId must match main conversation or derived subagent
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

    // (4) & (5) Resolve directory, check realpath boundary & reject symlinks
    let dataRoot: string | undefined;
    if (this.isolationMode === 'isolated_home' && session.accountName && this.homeIsolation) {
      dataRoot = this.homeIsolation.getHomePath(session.accountName);
    }

    const convDir = this.resolveConversationDir(conversationId, { dataRoot });

    let convDirReal: string;
    try {
      convDirReal = await fs.promises.realpath(convDir);
    } catch {
      throw new AppError('NOT_FOUND', 'Conversation directory not found');
    }

    const targetPath = path.resolve(convDirReal, relativePath);

    // Check target exists and reject symlinks
    let lstat: fs.Stats;
    try {
      lstat = await fs.promises.lstat(targetPath);
    } catch {
      throw new AppError('NOT_FOUND', `Artifact file not found: ${relativePath}`);
    }

    if (lstat.isSymbolicLink()) {
      throw new AppError('PATH_OUTSIDE_WORKSPACE', 'Symbolic links are not permitted');
    }

    let realTargetPath: string;
    try {
      realTargetPath = await fs.promises.realpath(targetPath);
    } catch {
      throw new AppError('NOT_FOUND', `Artifact file not found: ${relativePath}`);
    }

    const relFromConv = path.relative(convDirReal, realTargetPath);
    if (relFromConv.startsWith('..') || path.isAbsolute(relFromConv)) {
      throw new AppError('PATH_OUTSIDE_WORKSPACE', 'Artifact path escapes conversation directory');
    }

    const normConv = path.normalize(convDirReal).toLowerCase();
    const normTarget = path.normalize(realTargetPath).toLowerCase();
    if (!normTarget.startsWith(normConv + path.sep) && normTarget !== normConv) {
      throw new AppError('PATH_OUTSIDE_WORKSPACE', 'Artifact path escapes conversation directory');
    }

    if (!lstat.isFile()) {
      throw new AppError('NOT_FOUND', 'Target artifact is not a regular file');
    }

    const fileName = path.basename(realTargetPath);
    const mimeType = guessMimeType(fileName);
    const isSvg = mimeType === 'image/svg+xml' || fileName.toLowerCase().endsWith('.svg');
    const stream = fs.createReadStream(realTargetPath);

    return {
      stream,
      mimeType,
      fileName,
      isSvg,
    };
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

    let allSteps: TranscriptStep[] = [];
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

  /**
   * Cleans up all watches and timers.
   */
  dispose(): void {
    if (this.unsubscribeSupervisor) {
      this.unsubscribeSupervisor();
      this.unsubscribeSupervisor = undefined;
    }

    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    for (const handles of this.runWatches.values()) {
      for (const handle of handles.values()) {
        try {
          handle.stop();
        } catch {
          // ignore
        }
      }
    }
    this.runWatches.clear();
  }
}
