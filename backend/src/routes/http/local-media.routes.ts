import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../utils/errors.js';

const IMAGE_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

const MAX_BYTES = 25 * 1024 * 1024;

/** Turn file:///C:/foo or C:\foo into a normalized absolute path. */
export function resolveLocalMediaPath(raw: string): string {
  let input = raw.trim();
  if (!input) throw new AppError('BAD_REQUEST', 'path is required');

  if (/^file:/i.test(input)) {
    try {
      input = fileURLToLocalPath(input);
    } catch {
      throw new AppError('BAD_REQUEST', 'invalid file:// URL');
    }
  }

  const resolved = path.resolve(input);
  if (!isUnderGeminiHome(resolved)) {
    throw new AppError('PATH_OUTSIDE_WORKSPACE', 'local media path is outside ~/.gemini');
  }
  return resolved;
}

function fileURLToLocalPath(url: string): string {
  // file:///C:/Users/... or file:///C|/Users/... (Chrome) or file://localhost/C:/...
  let s = url.replace(/^file:\/\//i, '');
  s = s.replace(/^localhost/i, '');
  if (s.startsWith('/') && /^\/[A-Za-z]([:|])/.test(s)) {
    // /C:/... or /C|/...
    s = s.slice(1);
    if (s[1] === '|') s = `${s[0]}:${s.slice(2)}`;
  }
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  // Remaining leading / on Unix-style paths under Windows UNC is rare; normalize.
  return path.normalize(s);
}

function isUnderGeminiHome(resolved: string): boolean {
  const root = path.resolve(os.homedir(), '.gemini');
  const rel = path.relative(root, resolved);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export const localMediaRoutes: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((error, _request, reply) => {
    const appError = AppError.from(error);
    reply.status(appError.status).send(appError.toApiErrorResponse());
  });

  /**
   * Serve agent-generated images under ~/.gemini (brain scratch, etc.).
   * Browsers cannot load file:// from http://127.0.0.1; markdown rewrites to this endpoint.
   */
  app.get<{ Querystring: { path?: string } }>('/api/local-media', async (request, reply) => {
    const raw = request.query.path;
    if (!raw) throw new AppError('BAD_REQUEST', 'path query is required');

    const filePath = resolveLocalMediaPath(raw);
    const ext = path.extname(filePath).toLowerCase();
    const mime = IMAGE_EXT[ext];
    if (!mime) throw new AppError('BAD_REQUEST', `unsupported media type: ${ext || '(none)'}`);

    let st: fs.Stats;
    try {
      st = await fs.promises.stat(filePath);
    } catch {
      throw new AppError('NOT_FOUND', 'media file not found');
    }
    if (!st.isFile()) throw new AppError('NOT_FOUND', 'media path is not a file');
    if (st.size > MAX_BYTES) throw new AppError('BAD_REQUEST', 'media file too large');

    reply.header('Content-Type', mime);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(fs.createReadStream(filePath));
  });
};
