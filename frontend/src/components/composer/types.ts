import type { AgentInfo, AgentMode, Attachment, Effort, Model } from '@agy-studio/contracts';
import { UPLOAD_LIMITS } from '@agy-studio/contracts';
import type { SendMessageOptions } from '../../stores/session.store';

export type AttachmentStatus = 'pending' | 'compressing' | 'uploading' | 'uploaded' | 'error';

export interface ComposerAttachment {
  id: string;
  file: File;
  originalName: string;
  size: number;
  originalSize?: number;
  mimeType: string;
  status: AttachmentStatus;
  progress: number; // 0 - 100
  error?: string | null;
  uploadedAttachment?: Attachment;
}

export const COMPOSER_LIMITS = {
  maxFileSize: 30 * 1024 * 1024, // 30MB
  maxTotalSize: 100 * 1024 * 1024, // 100MB
  maxFilesPerUpload: UPLOAD_LIMITS.maxFilesPerRequest ?? 10, // 10
  imageMaxBytes: UPLOAD_LIMITS.imageMaxBytes, // 20MB
  fileMaxBytes: UPLOAD_LIMITS.fileMaxBytes, // 50MB
  maxImageDimension: 2048, // 2048px on longest side
} as const;

export interface ModelPickerProps {
  value?: string | null;
  onChange?: (model: string) => void;
  models?: Model[];
  disabled?: boolean;
  className?: string;
  loading?: boolean;
  fetched?: boolean;
  error?: string | null;
}

export interface EffortPickerProps {
  value?: Effort | null;
  onChange?: (effort: Effort) => void;
  disabled?: boolean;
  className?: string;
}

export interface ModePickerProps {
  value?: AgentMode | null;
  onChange?: (mode: AgentMode) => void;
  modes?: AgentMode[];
  disabled?: boolean;
  className?: string;
}

export interface AgentPickerProps {
  value?: string | null;
  onChange?: (agent: string) => void;
  agents?: AgentInfo[];
  disabled?: boolean;
  className?: string;
}

export interface AttachmentChipProps {
  attachment: ComposerAttachment;
  onDelete: (id: string) => void;
  onRetry?: (id: string) => void;
  disabled?: boolean;
  className?: string;
}

export interface ComposerProps {
  sessionId?: string;
  workspaceId?: string;
  placeholder?: string;
  disabled?: boolean;
  model?: string;
  effort?: Effort;
  mode?: AgentMode;
  agent?: string;
  onModelChange?: (model: string) => void;
  onEffortChange?: (effort: Effort) => void;
  onModeChange?: (mode: AgentMode) => void;
  onAgentChange?: (agent: string) => void;
  onSend?: (text: string, options?: SendMessageOptions) => Promise<void>;
  onAbort?: (runId: string) => Promise<void>;
  className?: string;
}
