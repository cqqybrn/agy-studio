import type { Artifact, ISODateString, TranscriptStep } from '@agy-studio/contracts';

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

export interface ArtifactWatchHandle {
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
   * List artifacts for a specific conversation / session directory.
   */
  listArtifacts(conversationId: string, sessionId: string, dataRoot?: string): Promise<Artifact[]>;

  /**
   * Watch artifacts within a conversation directory, invoking onChange when updated.
   */
  watchArtifacts(
    conversationId: string,
    sessionId: string,
    onChange: (artifact: Artifact) => void,
    dataRoot?: string,
  ): Promise<ArtifactWatchHandle>;

  /**
   * Purge conversation directory from disk.
   * Enforces strict UUID and directory boundary checks.
   */
  purgeConversation(conversationId: string, dataRoot?: string): Promise<void>;

  /**
   * Resolves the conversation directory on disk.
   */
  resolveConversationDir?(
    conversationId: string,
    options?: { dataRoot?: string; homeDir?: string },
  ): string;
}
