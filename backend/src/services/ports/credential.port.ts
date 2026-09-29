export interface CredentialSnapshot {
  readonly version: number;
  readonly createdAt: string;
  readonly targets: Record<string, string>;
  /** Credential manager UserName per target; older snapshots may lack it. */
  readonly targetUserNames?: Record<string, string>;
  readonly files: Record<string, string>; // relativePath -> base64 payload
}

export interface IdTokenClaims {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
  given_name?: string;
  [key: string]: unknown;
}

export interface CredentialPort {
  /**
   * Check whether any live credentials currently exist in the system store / file locations.
   */
  isPresent(): Promise<boolean>;

  /**
   * Capture a snapshot of current live credentials and persist it for the account.
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

  /** Identity claims of the live credentials, or null when absent or unreadable. */
  readLiveClaims(): Promise<IdTokenClaims | null>;

  /** Capture current live credentials in memory without persisting them. */
  takeLiveSnapshot(): Promise<CredentialSnapshot>;

  hasSnapshot(accountName: string): boolean;
  loadSnapshot(accountName: string): Promise<CredentialSnapshot>;
  deleteSnapshot(accountName: string): Promise<void>;

  /** Throws when the snapshot cannot be safely written back to the live slot. */
  assertRestorable(snapshot: CredentialSnapshot): void;

  /** Identity claims contained in a snapshot. */
  claimsOf(snapshot: CredentialSnapshot): IdTokenClaims | null;
}
