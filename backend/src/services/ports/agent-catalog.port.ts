import type { AgentInfo } from '@agy-studio/contracts';

export interface AgentCatalogPort {
  /**
   * Lists the built-in default agent plus custom agents for a workspace directory (if any) and the user.
   */
  listAgents(workspaceDir?: string | null): Promise<AgentInfo[]>;
}
