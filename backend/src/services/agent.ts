import type { AgentInfo } from '@agy-studio/contracts';
import type { WorkspacesRepository } from '../repositories/workspaces.js';
import type { AgentCatalogPort } from './ports/agent-catalog.port.js';
import { AppError } from '../utils/errors.js';

/** Values meaning "agy's built-in agent": no `--agent` flag is passed. */
const BUILTIN_AGENT_ALIASES = new Set(['default', 'builtin', '-', 'agy', 'antigravity']);

/** Must not start with '-' so it can never be read as another agy flag. */
const SAFE_AGENT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

export function isBuiltinAgent(agent: string | null | undefined): boolean {
  const name = agent?.trim() ?? '';
  return name === '' || BUILTIN_AGENT_ALIASES.has(name.toLowerCase());
}

export function isSafeAgentName(agent: string): boolean {
  return SAFE_AGENT_NAME.test(agent);
}

export interface AgentServiceOptions {
  catalog: AgentCatalogPort;
  workspacesRepo?: Pick<WorkspacesRepository, 'findById'>;
}

export class AgentService {
  private readonly catalog: AgentCatalogPort;
  private readonly workspacesRepo?: Pick<WorkspacesRepository, 'findById'>;

  constructor(options: AgentServiceOptions) {
    this.catalog = options.catalog;
    this.workspacesRepo = options.workspacesRepo;
  }

  async listAgents(workspaceId?: string): Promise<AgentInfo[]> {
    let workspaceDir: string | null = null;
    if (workspaceId) {
      const workspace = this.workspacesRepo?.findById(workspaceId);
      if (!workspace) {
        throw new AppError('NOT_FOUND', `Workspace ${workspaceId} not found`);
      }
      workspaceDir = workspace.path;
    }
    return this.catalog.listAgents(workspaceDir);
  }

  /**
   * Maps a requested agent to the `--agent` value: undefined for the built-in agent, otherwise
   * the name if it is listed for the workspace or consists only of safe characters.
   */
  async resolveAgentArg(
    agent: string | null | undefined,
    workspaceDir: string | null,
  ): Promise<string | undefined> {
    if (isBuiltinAgent(agent)) return undefined;
    const name = agent!.trim();
    if (!name.startsWith('-')) {
      if (isSafeAgentName(name)) return name;
      const listed = await this.catalog.listAgents(workspaceDir);
      if (listed.some((a) => a.scope !== 'builtin' && a.id === name)) return name;
    }
    throw new AppError('BAD_REQUEST', `Unknown or invalid agent "${name}"`, {
      details: { agent: name },
    });
  }
}
