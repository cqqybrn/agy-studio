export interface ConversationRewindRequest {
  conversationId: string;
  /** Workspace the conversation runs in (agy asks to trust it on first interactive use). */
  cwd: string;
  /** The user message to rewind to, as the user typed it. */
  messageText: string;
  /**
   * Which match to pick when several messages share this text: 1 = the latest one in agy's history,
   * 2 = the one before it, and so on.
   */
  occurrenceFromEnd: number;
  /**
   * The user message right before it (null when it is the first one). After rewinding, this must
   * be the latest message in agy's history; that is how the rewind is verified.
   */
  previousMessageText: string | null;
  env?: Record<string, string | undefined>;
}

/**
 * Rewinds an agy conversation so that the given user message and everything after it are dropped
 * from agy's own history (agy also reverts the file changes it made in those turns).
 */
export interface ConversationRewindPort {
  rewindToMessage(request: ConversationRewindRequest): Promise<void>;
}
