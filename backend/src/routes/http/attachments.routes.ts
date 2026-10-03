import fs from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { UPLOAD_LIMITS, type Attachment, type AttachmentKind } from '@agy-studio/contracts';
import type { AttachmentStore } from '../../services/attachment/store.js';
import type { AttachmentConverter } from '../../services/attachment/convert.js';
import { AppError } from '../../utils/errors.js';

export interface AttachmentsRoutesOptions {
  attachmentStore: AttachmentStore;
  attachmentConverter?: AttachmentConverter;
}

export const attachmentsRoutes: FastifyPluginAsync<AttachmentsRoutesOptions> = async (
  app,
  options,
) => {
  const { attachmentStore, attachmentConverter } = options;

  // 注册 @fastify/multipart 插件（遵守 UPLOAD_LIMITS）
  await app.register(multipart, {
    limits: {
      fileSize: UPLOAD_LIMITS.fileMaxBytes,
      files: UPLOAD_LIMITS.maxFilesPerRequest,
    },
  });

  app.setErrorHandler((error, _request, reply) => {
    // 检查 fastify multipart 抛出的文件过大错误 (FST_REQ_FILE_TOO_LARGE)
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      const appErr = new AppError('ATTACHMENT_TOO_LARGE', 'Attachment file exceeds maximum size limit');
      return reply.status(appErr.status).send(appErr.toApiErrorResponse());
    }

    const appError = AppError.from(error);
    reply.status(appError.status).send(appError.toApiErrorResponse());
  });

  // POST /api/attachments
  // multipart/form-data: fields `workspaceId`, optional `sessionId`, files under `files`
  app.post('/api/attachments', async (request, reply) => {
    if (!request.isMultipart()) {
      const err = new AppError('BAD_REQUEST', 'Request must be multipart/form-data');
      return reply.status(err.status).send(err.toApiErrorResponse());
    }

    const parts = request.parts();
    let workspaceId: string | undefined;
    let sessionId: string | undefined;
    const uploadedFiles: Array<{
      filename: string;
      mimetype: string;
      content: Buffer;
    }> = [];

    for await (const part of parts) {
      if (part.type === 'file') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        // 如果该流在读取过程中被截断（超出大小限制）
        if (part.file.truncated) {
          throw new AppError('ATTACHMENT_TOO_LARGE', `File ${part.filename} exceeds upload limit`);
        }

        uploadedFiles.push({
          filename: part.filename,
          mimetype: part.mimetype,
          content: buffer,
        });
      } else {
        // field
        if (part.fieldname === 'workspaceId') {
          workspaceId = part.value as string;
        } else if (part.fieldname === 'sessionId') {
          sessionId = part.value as string;
        }
      }
    }

    if (!workspaceId) {
      throw new AppError('BAD_REQUEST', 'workspaceId is required');
    }

    if (uploadedFiles.length === 0) {
      throw new AppError('BAD_REQUEST', 'At least one file must be uploaded under files');
    }

    if (uploadedFiles.length > UPLOAD_LIMITS.maxFilesPerRequest) {
      throw new AppError(
        'ATTACHMENT_TOO_LARGE',
        `Maximum ${UPLOAD_LIMITS.maxFilesPerRequest} files per request allowed`,
      );
    }

    const savedAttachments: Attachment[] = [];

    for (const file of uploadedFiles) {
      // 校验单文件大小与类型
      const isAllowedImage = (UPLOAD_LIMITS.imageMimeTypes as readonly string[]).includes(file.mimetype);
      let kind: AttachmentKind = 'file';

      if (isAllowedImage) {
        if (file.content.length > UPLOAD_LIMITS.imageMaxBytes) {
          throw new AppError(
            'ATTACHMENT_TOO_LARGE',
            `Image ${file.filename} exceeds imageMaxBytes limit (${UPLOAD_LIMITS.imageMaxBytes})`,
          );
        }
        kind = 'image';
      } else {
        // 非白名单图片类型或普通文件，按普通文件处理，检查 fileMaxBytes
        if (file.content.length > UPLOAD_LIMITS.fileMaxBytes) {
          throw new AppError(
            'ATTACHMENT_TOO_LARGE',
            `File ${file.filename} exceeds fileMaxBytes limit (${UPLOAD_LIMITS.fileMaxBytes})`,
          );
        }
        kind = 'file';
      }

      const attachment = await attachmentStore.save({
        workspaceId,
        sessionId: sessionId ?? null,
        filename: file.filename,
        mimeType: file.mimetype,
        content: file.content,
        kind,
      });

      // 尝试自动文本转换（针对 pdf / docx / xlsx）
      if (attachmentConverter && kind === 'file') {
        await attachmentConverter.convert(attachment);
      }

      savedAttachments.push(attachment);
    }

    return reply.status(200).send({ attachments: savedAttachments });
  });

  // GET /api/attachments/:attachmentId/raw
  app.get<{ Params: { attachmentId: string } }>(
    '/api/attachments/:attachmentId/raw',
    async (request, reply) => {
      const { attachmentId } = request.params;
      const { attachment, realPath } = attachmentStore.getAttachmentRaw(attachmentId);

      reply.header('Content-Type', attachment.mimeType);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Disposition', `inline; filename="${attachment.originalName}"`);

      const fileStream = fs.createReadStream(realPath);
      return reply.status(200).send(fileStream);
    },
  );
};
