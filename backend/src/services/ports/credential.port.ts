export interface CredentialSnapshot {
  readonly version: number;
  readonly createdAt: string;
  readonly targets: Record<string, string>;
  readonly files: Record<string, string>; // relativePath -> base64 payload
}

export interface CredentialPort {
  /**
   * Check whether any live credentials currently exist in the system store / file locations.
   */
  isPresent(): Promise<boolean>;

  /**
   * Capture a snapshot of current live credentials.
   */
  snapshot(accountName: string): Promise<CredentialSnapshot>;

  /**
   * Restore a snapshot into live credentials locations.
   */
  restore(snapshot: CredentialSnapshot): Promise<void>;

  /**
   * Clear live credentials from system store and configured files.
   */
  clear(): Promise<void>;
}
