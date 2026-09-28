import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AgentService } from '../../services/agent.js';
import { AppError } from '../../utils/errors.js';

export interface AgentsRoutesOptions {
  agentService: AgentService;
}

const ListAgentsQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
});

export const agentsRoutes: FastifyPluginAsync<AgentsRoutesOptions> = async (app, options) => {
  const { agentService } = options;

  app.setErrorHandler((error, _request, reply) => {
    const appError = AppError.from(error);
    reply.status(appError.status).send(appError.toApiErrorResponse());
  });

  // GET /api/agents
  app.get('/api/agents', async (request, reply) => {
    const queryParse = ListAgentsQuerySchema.safeParse(request.query);
    if (!queryParse.success) {
      const err = new AppError('BAD_REQUEST', 'Invalid query parameters');
      return reply.status(err.status).send(err.toApiErrorResponse());
    }

    try {
      const agents = await agentService.listAgents(queryParse.data.workspaceId);
      return reply.status(200).send(agents);
    } catch (err) {
      const appError = AppError.from(err);
      return reply.status(appError.status).send(appError.toApiErrorResponse());
    }
  });
};
