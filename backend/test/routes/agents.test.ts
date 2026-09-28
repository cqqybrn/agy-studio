import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { AgentInfo } from '@agy-studio/contracts';
import { createDatabase, WorkspacesRepository } from '../../src/repositories/index.js';
import { AgentCatalog } from '../../src/integrations/agy/agents.js';
import { AgentService } from '../../src/services/agent.js';
import { agentsRoutes } from '../../src/routes/http/agents.routes.js';

describe('Agents HTTP Routes', () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let tmp: string;
  let agentService: AgentService;

  beforeEach(async () => {
    tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-agents-route-'));
    const workspaceDir = path.join(tmp, 'project');
    const homeDir = path.join(tmp, 'home');
    const wsAgent = path.join(workspaceDir, '.agents', 'agents', 'reviewer');
    const globalAgent = path.join(homeDir, '.gemini', 'config', 'agents', 'planner');
    await fs.promises.mkdir(wsAgent, { recursive: true });
    await fs.promises.mkdir(globalAgent, { recursive: true });
    await fs.promises.writeFile(
      path.join(wsAgent, 'agent.md'),
      '---\nname: code-reviewer\ndescription: Reviews diffs\n---\n',
      'utf-8',
    );
    await fs.promises.writeFile(path.join(globalAgent, 'agent.md'), '# planner\n', 'utf-8');

    db = createDatabase(':memory:');
    const workspacesRepo = new WorkspacesRepository(db);
    workspacesRepo.create({
      id: 'ws-1',
      name: 'Project',
      path: workspaceDir,
      isGitRepo: false,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    });
    agentService = new AgentService({ catalog: new AgentCatalog(homeDir), workspacesRepo });

    app = Fastify();
    await app.register(agentsRoutes, { agentService });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  });

  it('GET /api/agents?workspaceId= returns default, workspace and global agents', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents?workspaceId=ws-1' });
    expect(res.statusCode).toBe(200);
    const agents = res.json() as AgentInfo[];
    expect(agents.map((a) => [a.id, a.scope])).toEqual([
      ['default', 'builtin'],
      ['code-reviewer', 'workspace'],
      ['planner', 'global'],
    ]);
    expect(agents[1].description).toBe('Reviews diffs');
  });

  it('GET /api/agents without workspaceId skips workspace agents', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as AgentInfo[]).map((a) => a.id)).toEqual(['default', 'planner']);
  });

  it('GET /api/agents returns 404 for an unknown workspace', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents?workspaceId=missing' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('resolveAgentArg accepts listed names with spaces but rejects unlisted unsafe names', async () => {
    const wsAgent = path.join(tmp, 'project', '.agents', 'agents', 'spaced');
    await fs.promises.mkdir(wsAgent, { recursive: true });
    await fs.promises.writeFile(path.join(wsAgent, 'agent.md'), '---\nname: Code Helper\n---\n', 'utf-8');
    const workspaceDir = path.join(tmp, 'project');

    expect(await agentService.resolveAgentArg('Code Helper', workspaceDir)).toBe('Code Helper');
    expect(await agentService.resolveAgentArg('default', workspaceDir)).toBeUndefined();
    expect(await agentService.resolveAgentArg(undefined, workspaceDir)).toBeUndefined();
    await expect(agentService.resolveAgentArg('../../etc', workspaceDir)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(agentService.resolveAgentArg('--help', workspaceDir)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});
