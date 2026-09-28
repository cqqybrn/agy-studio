import type { AgentMode, Model } from '@agy-studio/contracts';

export interface CatalogVersionInfo {
  version: string;
}

export interface ModelCatalogPort {
  /**
   * Get list of models available from the CLI or catalog discovery.
   */
  listModels(bin?: string): Promise<Model[]>;

  /**
   * Get CLI version.
   */
  getVersion(bin?: string): Promise<string | null>;

  /**
   * Get supported agent modes.
   */
  listModes(): Promise<AgentMode[]>;
}
