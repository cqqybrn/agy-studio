import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentCatalog, listAgents } from '../../src/integrations/agy/agents.js';
import { resolveAgentRoots } from '../../src/integrations/agy/paths.js';

async function writeAgent(root: string, dir: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.join(root, dir), { recursive: true });
  await fs.promises.writeFile(path.join(root, dir, 'agent.md'), content, 'utf-8');
}

describe('Integrations: agents.ts', () => {
  let tmp: string;
  let workspaceDir: string;
  let homeDir: string;
  let workspaceAgents: string;
  let globalAgents: string;

  beforeEach(async () => {
    tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-agents-test-'));
    workspaceDir = path.join(tmp, 'workspace');
    homeDir = path.join(tmp, 'home');
    workspaceAgents = path.join(workspaceDir, '.agents', 'agents');
    globalAgents = path.join(homeDir, '.gemini', 'config', 'agents');
  });

  afterEach(async () => {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  });

  it('resolves <workspace>\\.agents\\agents and <home>\\.gemini\\config\\agents', () => {
    expect(resolveAgentRoots(workspaceDir, homeDir)).toEqual([
      { root: workspaceAgents, scope: 'workspace' },
      { root: globalAgents, scope: 'global' },
    ]);
    expect(resolveAgentRoots(null, homeDir)).toEqual([{ root: globalAgents, scope: 'global' }]);
  });

  it('lists the built-in default first, then workspace and global agents with frontmatter name/description', async () => {
    await writeAgent(
      workspaceAgents,
      'reviewer-dir',
      '---\nname: code-reviewer\ndescription: Reviews diffs\n---\n\nYou review code.\n',
    );
    await writeAgent(globalAgents, 'planner', '# Planner\n\nNo frontmatter here.\n');
    await writeAgent(globalAgents, 'quoted', '\uFEFF---\nname: "quoted-agent"\n---\nbody\n');
    // 没有 agent.md 的目录、以及普通文件都不算 agent
    await fs.promises.mkdir(path.join(globalAgents, 'empty-dir'), { recursive: true });
    await fs.promises.writeFile(path.join(globalAgents, 'stray.md'), 'x', 'utf-8');

    const agents = await listAgents(workspaceDir, homeDir);

    expect(agents[0]).toMatchObject({ id: 'default', scope: 'builtin' });
    expect(agents.slice(1)).toEqual([
      { id: 'code-reviewer', name: 'code-reviewer', description: 'Reviews diffs', scope: 'workspace' },
      { id: 'planner', name: 'planner', description: null, scope: 'global' },
      { id: 'quoted-agent', name: 'quoted-agent', description: null, scope: 'global' },
    ]);
  });

  it('returns only the default agent when no agent directories exist', async () => {
    const catalog = new AgentCatalog(homeDir);
    expect(await catalog.listAgents(workspaceDir)).toEqual([
      expect.objectContaining({ id: 'default', scope: 'builtin' }),
    ]);
  });
});
