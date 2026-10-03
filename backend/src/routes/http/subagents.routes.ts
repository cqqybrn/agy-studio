import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { SubagentTranscriptService } from '../../services/subagent-transcript.js';
import { AppError } from '../../utils/errors.js';

export interface SubagentsRoutesOptions {
  subagentTranscriptService: SubagentTranscriptService;
}

const TranscriptQuerySchema = z.object({
  afterStep: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const subagentsRoutes: FastifyPluginAsync<SubagentsRoutesOptions> = async (
  app,
  options,
) => {
  const { subagentTranscriptService } = options;

  app.setErrorHandler((error, _request, reply) => {
    const appError = AppError.from(error);
    reply.status(appError.status).send(appError.toApiErrorResponse());
  });

  // GET /api/sessions/:sessionId/subagents/:conversationId/transcript
  app.get(
    '/api/sessions/:sessionId/subagents/:conversationId/transcript',
    async (request, reply) => {
      const { sessionId, conversationId } = request.params as {
        sessionId: string;
        conversationId: string;
      };

      const parseResult = TranscriptQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        const err = new AppError(
          'BAD_REQUEST',
          parseResult.error.issues[0]?.message ?? 'Invalid query parameters',
        );
        return reply.status(err.status).send(err.toApiErrorResponse());
      }

      const result = await subagentTranscriptService.getSubagentTranscript(
        sessionId,
        conversationId,
        parseResult.data,
      );

      return reply.status(200).send(result);
    },
  );
};
