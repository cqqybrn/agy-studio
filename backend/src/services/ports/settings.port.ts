export type SettingsScope = 'global' | 'workspace';

export interface EnsureAlwaysProceedOptions {
  workspacePath?: string;
  homeDir?: string;
}

export interface EnsureAlwaysProceedResult {
  updated: boolean;
  filePath: string;
  warning?: string;
}

export interface SettingsPort {
  /**
   * Ensure the settings for the given scope are configured to always proceed.
   */
  ensureAlwaysProceed(
    scope: SettingsScope,
    options?: EnsureAlwaysProceedOptions,
  ): Promise<EnsureAlwaysProceedResult>;

  /**
   * Install the statusline bridge hook into the settings file.
   */
  installStatusline(homeDir?: string): Promise<void>;

  /**
   * Uninstall the statusline bridge hook and restore previous settings.
   */
  uninstallStatusline(homeDir?: string): Promise<void>;
}
