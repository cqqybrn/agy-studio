import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { DirectoryBrowser } from '../../services/directory-browser.js';
import type { WorkspaceService } from '../../services/workspace.js';
import { AppError } from '../../utils/errors.js';

export interface WorkspacesRoutesOptions {
  workspaceService: WorkspaceService;
  directoryBrowser: DirectoryBrowser;
}

const CreateWorkspaceSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  name: z.string().optional(),
});

export const workspacesRoutes: FastifyPluginAsync<WorkspacesRoutesOptions> = async (
  app,
  options,
) => {
  const { workspaceService, directoryBrowser } = options;

  // 全局/插件错误处理（按 ERROR_HTTP_STATUS 映射 HTTP 状态码并返回 ApiErrorResponse）
  app.setErrorHandler((error, _request, reply) => {
    const appError = AppError.from(error);
    reply.status(appError.status).send(appError.toApiErrorResponse());
  });

  // GET /api/fs/directories?path= — folder picker for new workspaces
  app.get<{ Querystring: { path?: string } }>('/api/fs/directories', async (request, reply) => {
    try {
      return await directoryBrowser.list(request.query.path);
    } catch (err) {
      const appError = AppError.from(err);
      return reply.status(appError.status).send(appError.toApiErrorResponse());
    }
  });

  // GET /api/workspaces
  app.get('/api/workspaces', async () => {
    return workspaceService.listWorkspaces();
  });

  // POST /api/workspaces
  app.post('/api/workspaces', async (request, reply) => {
    const parseResult = CreateWorkspaceSchema.safeParse(request.body);
    if (!parseResult.success) {
      const err = new AppError('BAD_REQUEST', parseResult.error.issues[0]?.message ?? 'Invalid request body');
      return reply.status(err.status).send(err.toApiErrorResponse());
    }

    try {
      const workspace = await workspaceService.createWorkspace(parseResult.data);
      return reply.status(201).send(workspace);
    } catch (err) {
      const appError = AppError.from(err);
      return reply.status(appError.status).send(appError.toApiErrorResponse());
    }
  });

  // DELETE /api/workspaces/:workspaceId
  app.delete<{ Params: { workspaceId: string } }>(
    '/api/workspaces/:workspaceId',
    async (request, reply) => {
      const { workspaceId } = request.params;
      if (!workspaceId) {
        const err = new AppError('BAD_REQUEST', 'Workspace ID is required');
        return reply.status(err.status).send(err.toApiErrorResponse());
      }

      try {
        await workspaceService.deleteWorkspace(workspaceId);
        return { ok: true };
      } catch (err) {
        const appError = AppError.from(err);
        return reply.status(appError.status).send(appError.toApiErrorResponse());
      }
    },
  );
};
