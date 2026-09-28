import type { AgentInfo } from '@agy-studio/contracts';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentCatalogPort } from '../../services/ports/agent-catalog.port.js';
import { resolveAgentRoots } from './paths.js';

export const DEFAULT_AGENT: AgentInfo = {
  id: 'default',
  name: 'Default agent',
  description: 'Built-in Antigravity default agent',
  scope: 'builtin',
};

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
    return v.slice(1, -1).trim();
  }
  return v;
}

/**
 * Reads `<dir>/agent.md`; name/description come from the leading `---` frontmatter,
 * falling back to the directory name. Returns null when agent.md is missing or not a regular file.
 */
export async function readAgentMd(
  dir: string,
  scope: AgentInfo['scope'],
): Promise<AgentInfo | null> {
  const mdPath = path.join(dir, 'agent.md');
  try {
    const st = await fs.promises.lstat(mdPath);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  let text: string;
  try {
    text = await fs.promises.readFile(mdPath, 'utf-8');
  } catch {
    return null;
  }

  const dirName = path.basename(dir);
  let name = dirName;
  let description: string | null = null;
  const fm = text.replace(/^\uFEFF/, '').match(/^---\s*([\s\S]*?)\s*---/);
  if (fm) {
    const mName = fm[1].match(/^\s*name:\s*(.+)$/m);
    const mDesc = fm[1].match(/^\s*description:\s*(.+)$/m);
    if (mName && unquote(mName[1])) name = unquote(mName[1]);
    if (mDesc && unquote(mDesc[1])) description = unquote(mDesc[1]);
  }
  return { id: name, name, description, scope };
}

/**
 * Built-in default agent, then workspace agents (`<workspaceDir>/.agents/agents/*`) and
 * global agents (`%USERPROFILE%/.gemini/config/agents/*`), each defined by an agent.md.
 */
export async function listAgents(
  workspaceDir?: string | null,
  homeDir?: string,
): Promise<AgentInfo[]> {
  const custom: AgentInfo[] = [];
  for (const { root, scope } of resolveAgentRoots(workspaceDir, homeDir)) {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const agent = await readAgentMd(path.join(root, entry.name), scope);
      if (agent) custom.push(agent);
    }
  }
  custom.sort((a, b) => a.name.localeCompare(b.name));
  return [{ ...DEFAULT_AGENT }, ...custom];
}

export class AgentCatalog implements AgentCatalogPort {
  constructor(private readonly homeDir?: string) {}

  listAgents(workspaceDir?: string | null): Promise<AgentInfo[]> {
    return listAgents(workspaceDir, this.homeDir);
  }
}
