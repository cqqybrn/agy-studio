import fs from 'node:fs';
import path from 'node:path';
import type { Attachment, AttachmentKind } from '@agy-studio/contracts';
import type { AttachmentsRepository } from '../../repositories/attachments.js';
import type { WorkspacesRepository } from '../../repositories/workspaces.js';
import { AppError } from '../../utils/errors.js';
import { createId } from '../../utils/ids.js';

export interface SaveAttachmentInput {
  workspaceId: string;
  sessionId?: string | null;
  filename: string;
  mimeType: string;
  content: Buffer;
  kind?: AttachmentKind;
}

const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * Sanitizes a filename:
 * 1. Takes only basename (strips paths)
 * 2. Retains only [A-Za-z0-9._-]
 * 3. Handles Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9) by prefixing `_`
 * 4. Ensures filename is not empty
 */
export function sanitizeFilename(rawFilename: string): string {
  const base = path.basename(rawFilename);
  // Keep only [A-Za-z0-9._-]
  let sanitized = base.replace(/[^A-Za-z0-9._-]/g, '_');

  // Strip leading dots to prevent hidden/special files or relative navigation
  sanitized = sanitized.replace(/^\.+/, '');
  if (!sanitized) {
    sanitized = 'attachment';
  }

  // Check Windows reserved names (ignoring extension)
  const ext = path.extname(sanitized);
  const nameWithoutExt = path.basename(sanitized, ext).toUpperCase();
  if (WINDOWS_RESERVED_NAMES.has(nameWithoutExt)) {
    sanitized = `_${sanitized}`;
  }

  return sanitized;
}

/**
 * Ensures that the workspace .gitignore exists and includes `.agy-attachments/`
 */
export function ensureGitignore(workspacePath: string): void {
  const gitignorePath = path.join(workspacePath, '.gitignore');
  const entry = '.agy-attachments/';

  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      const lines = content.split(/\r?\n/).map((l) => l.trim());
      if (!lines.includes('.agy-attachments/') && !lines.includes('.agy-attachments')) {
        const trailingNewline = content.endsWith('\n') || content.endsWith('\r\n') ? '' : '\n';
        fs.appendFileSync(gitignorePath, `${trailingNewline}${entry}\n`, 'utf-8');
      }
    } else {
      fs.writeFileSync(gitignorePath, `${entry}\n`, 'utf-8');
    }
  } catch {
    // If updating .gitignore fails, do not block attachment upload
  }
}

export interface AttachmentStoreOptions {
  attachmentsRepo: AttachmentsRepository;
  workspacesRepo: WorkspacesRepository;
}

export class AttachmentStore {
  private readonly attachmentsRepo: AttachmentsRepository;
  private readonly workspacesRepo: WorkspacesRepository;

  constructor(options: AttachmentStoreOptions) {
    this.attachmentsRepo = options.attachmentsRepo;
    this.workspacesRepo = options.workspacesRepo;
  }

  async save(input: SaveAttachmentInput): Promise<Attachment> {
    const workspace = this.workspacesRepo.findById(input.workspaceId);
    if (!workspace) {
      throw new AppError('NOT_FOUND', `Workspace ${input.workspaceId} not found`);
    }

    const workspaceDir = path.resolve(workspace.path);
    if (!fs.existsSync(workspaceDir)) {
      throw new AppError('NOT_FOUND', `Workspace directory does not exist: ${workspace.path}`);
    }

    const attachmentsRoot = path.resolve(workspaceDir, '.agy-attachments');
    ensureGitignore(workspaceDir);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const dateDir = path.join(attachmentsRoot, dateStr);

    fs.mkdirSync(dateDir, { recursive: true });

    const attachmentId = createId('att');
    const cleanFilename = sanitizeFilename(input.filename);
    const targetFileName = `${attachmentId}-${cleanFilename}`;
    const targetFilePath = path.join(dateDir, targetFileName);

    // Write file
    fs.writeFileSync(targetFilePath, input.content);

    // Realpath verification: ensure targetFilePath is strictly inside attachmentsRoot
    const realRoot = fs.realpathSync(attachmentsRoot);
    const realTarget = fs.realpathSync(targetFilePath);

    // Must be inside realRoot
    const relative = path.relative(realRoot, realTarget);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      try {
        fs.unlinkSync(targetFilePath);
      } catch {
        // ignore
      }
      throw new AppError('PATH_OUTSIDE_WORKSPACE', 'Attachment path escaped attachments directory');
    }

    const kind: AttachmentKind = input.kind ?? (input.mimeType.startsWith('image/') ? 'image' : 'file');

    const attachment: Attachment = {
      id: attachmentId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId ?? null,
      kind,
      originalName: input.filename,
      mimeType: input.mimeType,
      size: input.content.length,
      storedPath: realTarget,
      derivedTextPath: null,
      createdAt: now.toISOString(),
    };

    this.attachmentsRepo.create(attachment);
    return attachment;
  }

  getAttachmentRaw(attachmentId: string): { attachment: Attachment; realPath: string } {
    const attachment = this.attachmentsRepo.findById(attachmentId);
    if (!attachment) {
      throw new AppError('NOT_FOUND', `Attachment ${attachmentId} not found`);
    }

    const workspace = this.workspacesRepo.findById(attachment.workspaceId);
    if (!workspace) {
      throw new AppError('NOT_FOUND', `Workspace ${attachment.workspaceId} not found`);
    }

    if (!fs.existsSync(attachment.storedPath)) {
      throw new AppError('NOT_FOUND', `Attachment file not found at ${attachment.storedPath}`);
    }

    const realTarget = fs.realpathSync(attachment.storedPath);
    const attachmentsRoot = path.resolve(workspace.path, '.agy-attachments');
    if (!fs.existsSync(attachmentsRoot)) {
      throw new AppError('PATH_OUTSIDE_WORKSPACE', 'Attachments directory not found in workspace');
    }
    const realRoot = fs.realpathSync(attachmentsRoot);

    const relative = path.relative(realRoot, realTarget);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppError('PATH_OUTSIDE_WORKSPACE', 'Attachment file escaped workspace attachments directory');
    }

    return {
      attachment,
      realPath: realTarget,
    };
  }
}
