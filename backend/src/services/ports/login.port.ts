import type { AccountLoginSession } from '@agy-studio/contracts';

export interface StartLoginOptions {
  accountName: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

export interface LoginHandle {
  readonly loginId: string;
  readonly session: AccountLoginSession;
  waitForAuthUrl(): Promise<string>;
  waitForCompletion(): Promise<AccountLoginSession>;
  cancel(): Promise<void>;
}

export interface LoginPort {
  /**
   * Spawns login flow in a pseudo-terminal.
   */
  startLogin(options: StartLoginOptions): Promise<LoginHandle>;
}
