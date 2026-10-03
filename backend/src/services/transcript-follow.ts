import type { AgentEvent } from '@agy-studio/contracts';
import type { SessionsRepository } from '../repositories/sessions.js';
import type { BrainPort, RunTranscriptHandle } from './ports/brain.port.js';

export interface TranscriptFollowLogger {
  error(obj: unknown, msg?: string): void;
  warn?(obj: unknown, msg?: string): void;
}

export interface TranscriptFollowServiceOptions {
  brainPort: BrainPort;
  sessionsRepo: Pick<SessionsRepository, 'findById'>;
  publish: (sessionId: string, runId: string, event: AgentEvent) => Promise<void>;
  /** Called for every new transcript step of an active run. */
  onActivity?: (runId: string) => void;
  /**
   * How long a transcript-derived event waits for stdout to deliver the same step first.
   * stdout normally wins this race; the transcript only fills in while stdout is held back.
   */
  graceMs?: number;
  /** Retry interval while the run's conversation id is not known yet. */
  conversationPollMs?: number;
  logger?: TranscriptFollowLogger;
}

type TranscriptToolState = 'running' | 'finished';

interface RunFollowState {
  sessionId: string;
  runId: string;
  startedAt: string;
  handle: RunTranscriptHandle | null;
  starting: boolean;
  stopped: boolean;
  pollTimer: NodeJS.Timeout | null;
  graceTimers: Set<NodeJS.Timeout>;
  publishChain: Promise<void>;
  /** message / tool ids already delivered by stdout */
  streamIds: Set<string>;
  streamFinishedTools: Set<string>;
  /** ids delivered from the transcript */
  transcriptMessages: Set<string>;
  transcriptTools: Map<string, TranscriptToolState>;
}

/**
 * agy holds back stdout behind a step that never finishes (e.g. a background `ssh` waiting for a
 * password), while it keeps working and appending to its transcript on disk. During a run this
 * service follows the main conversation's transcript and publishes its message / tool steps when
 * stdout has not delivered them, deduplicated against stdout by item id.
 *
 * stdout stays authoritative: `filterStreamEvent` decides which stdout events still need
 * publishing (a message already published in full from the transcript must not be appended to
 * again; a tool already finished must not go back to running).
 */
export class TranscriptFollowService {
  private readonly brainPort: BrainPort;
  private readonly sessionsRepo: Pick<SessionsRepository, 'findById'>;
  private readonly publish: TranscriptFollowServiceOptions['publish'];
  private readonly onActivity?: (runId: string) => void;
  private readonly graceMs: number;
  private readonly conversationPollMs: number;
  private readonly logger?: TranscriptFollowLogger;

  private readonly runs = new Map<string, RunFollowState>();

  constructor(options: TranscriptFollowServiceOptions) {
    this.brainPort = options.brainPort;
    this.sessionsRepo = options.sessionsRepo;
    this.publish = options.publish;
    this.onActivity = options.onActivity;
    this.graceMs = options.graceMs ?? 3_000;
    this.conversationPollMs = options.conversationPollMs ?? 1_000;
    this.logger = options.logger;
  }

  /**
   * Observes a stdout event of a run and returns whether it should still be published.
   */
  filterStreamEvent(sessionId: string, runId: string, event: AgentEvent): boolean {
    if (event.type === 'run.started') {
      this.beginRun(sessionId, runId);
      return true;
    }
    if (event.type === 'run.completed') {
      this.endRun(runId);
      return true;
    }

    const state = this.runs.get(runId);
    if (!state) return true;

    switch (event.type) {
      case 'message.delta':
      case 'message.done':
        if (state.transcriptMessages.has(event.messageId)) return false;
        state.streamIds.add(event.messageId);
        return true;
      case 'tool.started':
        state.streamIds.add(event.tool.toolCallId);
        return state.transcriptTools.get(event.tool.toolCallId) !== 'finished';
      case 'tool.finished':
        state.streamIds.add(event.tool.toolCallId);
        state.streamFinishedTools.add(event.tool.toolCallId);
        return true;
      default:
        return true;
    }
  }

  /** Stops following all runs. */
  dispose(): void {
    for (const runId of [...this.runs.keys()]) {
      this.endRun(runId);
    }
  }

  private beginRun(sessionId: string, runId: string): void {
    if (this.runs.has(runId) || !this.brainPort.followRunTranscript) return;
    const state: RunFollowState = {
      sessionId,
      runId,
      startedAt: new Date().toISOString(),
      handle: null,
      starting: false,
      stopped: false,
      pollTimer: null,
      graceTimers: new Set(),
      publishChain: Promise.resolve(),
      streamIds: new Set(),
      streamFinishedTools: new Set(),
      transcriptMessages: new Set(),
      transcriptTools: new Map(),
    };
    this.runs.set(runId, state);

    // A new session learns its conversation id from agy's init event, after run.started.
    state.pollTimer = setInterval(() => {
      void this.tryStartFollowing(state);
    }, this.conversationPollMs);
    void this.tryStartFollowing(state);
  }

  private endRun(runId: string): void {
    const state = this.runs.get(runId);
    if (!state) return;
    this.runs.delete(runId);
    state.stopped = true;
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    for (const timer of state.graceTimers) {
      clearTimeout(timer);
    }
    state.graceTimers.clear();
    try {
      state.handle?.stop();
    } catch (err) {
      this.logger?.error({ err, runId }, 'Failed to stop transcript follow handle');
    }
    state.handle = null;
  }

  private async tryStartFollowing(state: RunFollowState): Promise<void> {
    if (state.stopped || state.handle || state.starting) return;
    const conversationId = this.sessionsRepo.findById(state.sessionId)?.agyConversationId;
    if (!conversationId || !this.brainPort.followRunTranscript) return;

    state.starting = true;
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }

    let handle: RunTranscriptHandle;
    try {
      handle = await this.brainPort.followRunTranscript(conversationId, {
        runId: state.runId,
        runStartedAt: state.startedAt,
      });
    } catch (err) {
      state.starting = false;
      this.logger?.warn?.(
        { err, runId: state.runId, conversationId },
        'Failed to follow run transcript',
      );
      return;
    }

    state.starting = false;
    if (state.stopped) {
      handle.stop();
      return;
    }
    state.handle = handle;
    void this.consume(state, handle);
  }

  private async consume(state: RunFollowState, handle: RunTranscriptHandle): Promise<void> {
    try {
      for await (const batch of handle.batches) {
        if (state.stopped) break;
        this.onActivity?.(state.runId);
        for (const event of batch) {
          this.schedule(state, event);
        }
      }
    } catch (err) {
      this.logger?.warn?.({ err, runId: state.runId }, 'Run transcript follow ended with error');
    }
  }

  private schedule(state: RunFollowState, event: AgentEvent): void {
    const timer = setTimeout(() => {
      state.graceTimers.delete(timer);
      state.publishChain = state.publishChain.then(() => this.publishFromTranscript(state, event));
    }, this.graceMs);
    state.graceTimers.add(timer);
  }

  private async publishFromTranscript(state: RunFollowState, event: AgentEvent): Promise<void> {
    if (state.stopped) return;

    switch (event.type) {
      case 'message.delta':
        if (state.streamIds.has(event.messageId) || state.transcriptMessages.has(event.messageId)) {
          return;
        }
        state.transcriptMessages.add(event.messageId);
        break;
      case 'message.done':
        // Only close messages this service opened.
        if (!state.transcriptMessages.has(event.messageId)) return;
        break;
      case 'tool.started':
        if (
          state.streamIds.has(event.tool.toolCallId) ||
          state.transcriptTools.has(event.tool.toolCallId)
        ) {
          return;
        }
        state.transcriptTools.set(event.tool.toolCallId, 'running');
        break;
      case 'tool.finished':
        if (
          state.streamFinishedTools.has(event.tool.toolCallId) ||
          state.transcriptTools.get(event.tool.toolCallId) === 'finished'
        ) {
          return;
        }
        state.transcriptTools.set(event.tool.toolCallId, 'finished');
        break;
      default:
        return;
    }

    try {
      await this.publish(state.sessionId, state.runId, event);
    } catch (err) {
      this.logger?.error(
        { err, runId: state.runId, eventType: event.type },
        'Failed to publish transcript-derived event',
      );
    }
  }
}
