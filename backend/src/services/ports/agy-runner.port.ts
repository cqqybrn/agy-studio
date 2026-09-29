import type { AgentEvent } from '@agy-studio/contracts';

export interface SpawnRunnerOptions {
  bin?: string;
  argv?: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  sessionId?: string;
  runId?: string;
  onConversationId?: (conversationId: string) => void;
}

export interface RunnerProcess {
  readonly pid: number | undefined;
  readonly events: AsyncIterable<AgentEvent>;
  send(text: string, images?: string[]): Promise<void>;
  closeInput(): void;
  kill(): Promise<void>;
  readonly exited: Promise<{ exitCode: number | null; signal: string | null }>;
}

export interface AgyRunnerPort {
  start(options: SpawnRunnerOptions): Promise<RunnerProcess>;
}

/** The subset of the agy profile that decides how attachments are injected into a user frame. */
export interface ImageInputProfile {
  stream?: {
    imageInput?: {
      supported: boolean;
      template: string | Record<string, unknown> | null;
    };
  };
}
