import type { AgentEvent, ISODateString, TranscriptStep } from '@agy-studio/contracts';

export interface DiskConversationSummary {
  id: string;
  title: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface TranscriptTailOptions {
  fromStep?: number;
}

export interface TranscriptTailHandle {
  steps: AsyncIterable<TranscriptStep>;
  stop(): void;
}

export interface RunTranscriptOptions {
  runId: string;
  runStartedAt: ISODateString;
}

export interface RunTranscriptHandle {
  /**
   * One batch per new transcript step of this run, in step order. A batch may be empty
   * (thinking, system messages): it still proves agy is making progress.
   */
  batches: AsyncIterable<AgentEvent[]>;
  stop(): void;
}

export interface BrainPort {
  /**
   * List conversations recorded on disk under data root(s).
   * In isolated_home mode, dataRoot may be specific to an account's home.
   */
  listConversations(dataRoot?: string): Promise<DiskConversationSummary[]>;

  /**
   * Tail a conversation's transcript incrementally from disk.
   */
  tailTranscript(
    conversationId: string,
    options?: TranscriptTailOptions,
    dataRoot?: string,
  ): Promise<TranscriptTailHandle>;

  /**
   * Purge a conversation from disk: brain dir, conversations\<id>.db* and subagent conversations.
   * Enforces strict UUID and directory boundary checks.
   */
  purgeConversation(conversationId: string, dataRoot?: string): Promise<void>;

  /**
   * Follows the main conversation's transcript during a run and maps its steps to the same
   * message / tool events (same ids) that the stdout stream produces.
   */
  followRunTranscript?(
    conversationId: string,
    options: RunTranscriptOptions,
    dataRoot?: string,
  ): Promise<RunTranscriptHandle>;

  /**
   * Resolves the conversation directory on disk.
   */
  resolveConversationDir?(
    conversationId: string,
    options?: { dataRoot?: string; homeDir?: string },
  ): string;
}
