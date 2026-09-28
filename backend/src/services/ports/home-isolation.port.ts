export interface HomeIsolationPort {
  /**
   * Creates/ensures directory structure DATA_DIR/profiles/<accountName>/home exists.
   */
  createHome(accountName: string): Promise<string>;

  /**
   * Returns environment variables overriding home/appdata locations for the account.
   */
  envFor(accountName: string): Promise<Record<string, string>>;

  /**
   * Resolves the absolute path to the isolated home directory for the account.
   */
  getHomePath(accountName: string): string;
}
