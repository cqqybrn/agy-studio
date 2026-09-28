import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ArtifactService } from '../../services/artifact.js';
import { AppError } from '../../utils/errors.js';

export interface ArtifactsRoutesOptions {
  artifactService: ArtifactService;
}

const TranscriptQuerySchema = z.object({
  afterStep: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const artifactsRoutes: FastifyPluginAsync<ArtifactsRoutesOptions> = async (
  app,
  options,
) => {
  const { artifactService } = options;

  app.setErrorHandler((error, _request, reply) => {
    const appError = AppError.from(error);
    reply.status(appError.status).send(appError.toApiErrorResponse());
  });

  // GET /api/sessions/:sessionId/artifacts
  app.get('/api/sessions/:sessionId/artifacts', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const artifacts = await artifactService.listArtifacts(sessionId);
    return reply.status(200).send(artifacts);
  });

  // GET /api/sessions/:sessionId/artifacts/:artifactId/raw
  app.get('/api/sessions/:sessionId/artifacts/:artifactId/raw', async (request, reply) => {
    const { sessionId, artifactId } = request.params as {
      sessionId: string;
      artifactId: string;
    };

    const raw = await artifactService.getArtifactRaw(sessionId, artifactId);

    reply.header('Content-Type', raw.mimeType);
    reply.header('X-Content-Type-Options', 'nosniff');

    if (raw.isSvg) {
      reply.header('Content-Disposition', `attachment; filename="${raw.fileName}"`);
    } else {
      reply.header('Content-Disposition', `inline; filename="${raw.fileName}"`);
    }

    return reply.status(200).send(raw.stream);
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

      const result = await artifactService.getSubagentTranscript(
        sessionId,
        conversationId,
        parseResult.data,
      );

      return reply.status(200).send(result);
    },
  );
};
