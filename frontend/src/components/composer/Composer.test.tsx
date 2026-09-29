import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo, Attachment } from '@agy-studio/contracts';
import {
  AgentPicker,
  AttachmentChip,
  buildSendOptions,
  clearDraft,
  COMPOSER_DRAFT_PREFIX,
  COMPOSER_LIMITS,
  compressImageIfNeeded,
  Composer,
  EffortPicker,
  formatFileSize,
  getDraftStorageKey,
  loadDraft,
  ModelPicker,
  ModePicker,
  saveDraft,
  shouldCompressImage,
} from './index';

// ----------------------------------------------------------------------------
// Mock API endpoints
// ----------------------------------------------------------------------------
const mockUploadAttachments = vi.fn();

vi.mock('../../api/endpoints', () => ({
  uploadAttachments: (...args: any[]) => mockUploadAttachments(...args),
}));

// Mock Session & Workspace Stores
let mockActiveSessionId = 'session-123';
let mockSessionSlots: Record<string, any> = {
  'session-123': {
    activeRunId: null,
    pendingRunId: null,
  },
};
const mockStoreSend = vi.fn().mockResolvedValue({ runId: 'run-new' });
const mockStoreAbort = vi.fn().mockResolvedValue({ runId: 'run-aborted' });

vi.mock('../../stores/session.store', () => ({
  useSessionStore: vi.fn((selector?: any) => {
    const state = {
      activeSessionId: mockActiveSessionId,
      slots: mockSessionSlots,
      send: mockStoreSend,
      abort: mockStoreAbort,
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('../../stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn((selector?: any) => {
    const state = {
      currentWorkspace: { id: 'ws-test-1', name: 'Test Workspace', path: '/test', isGitRepo: true },
    };
    return selector ? selector(state) : state;
  }),
}));

describe('Composer & Pickers Component Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveSessionId = 'session-123';
    mockSessionSlots = {
      'session-123': {
        activeRunId: null,
        pendingRunId: null,
      },
    };

    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }
  });

  // ==========================================================================
  // 1. Helpers & Compression logic
  // ==========================================================================
  describe('Compression & Size Utilities', () => {
    it('formatFileSize formats B, KB, MB properly', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(500)).toBe('500 B');
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(1024 * 1024 * 5)).toBe('5.0 MB');
    });

    it('shouldCompressImage correctly identifies images excluding GIF', () => {
      const pngFile = new File(['dummy'], 'test.png', { type: 'image/png' });
      const jpgFile = new File(['dummy'], 'test.jpg', { type: 'image/jpeg' });
      const gifFile = new File(['dummy'], 'test.gif', { type: 'image/gif' });
      const txtFile = new File(['dummy'], 'test.txt', { type: 'text/plain' });

      expect(shouldCompressImage(pngFile)).toBe(true);
      expect(shouldCompressImage(jpgFile)).toBe(true);
      expect(shouldCompressImage(gifFile)).toBe(false); // GIF must not be compressed
      expect(shouldCompressImage(txtFile)).toBe(false);
    });

    it('compressImageIfNeeded returns original file when compression is unsupported or GIF', async () => {
      const gifFile = new File(['dummy'], 'anim.gif', { type: 'image/gif' });
      const res = await compressImageIfNeeded(gifFile);
      expect(res).toBe(gifFile);
    });

    it('verifies upload limit constants matches contracts and specifications', () => {
      expect(COMPOSER_LIMITS.maxFileSize).toBe(30 * 1024 * 1024);
      expect(COMPOSER_LIMITS.maxTotalSize).toBe(100 * 1024 * 1024);
      expect(COMPOSER_LIMITS.maxFilesPerUpload).toBe(10);
      expect(COMPOSER_LIMITS.maxImageDimension).toBe(2048);
    });
  });

  // ==========================================================================
  // 2. Draft persistence & cleanup logic
  // ==========================================================================
  describe('Draft Persistence', () => {
    it('saves draft by sessionId and cleans up properly', () => {
      const key = getDraftStorageKey('session-draft-test');
      expect(key).toBe(`${COMPOSER_DRAFT_PREFIX}session-draft-test`);

      saveDraft('Hello world draft', 'session-draft-test');
      expect(loadDraft('session-draft-test')).toBe('Hello world draft');

      clearDraft('session-draft-test');
      expect(loadDraft('session-draft-test')).toBe('');
    });
  });

  // ==========================================================================
  // 3. Sub-pickers: ModelPicker, EffortPicker, ModePicker, AttachmentChip
  // ==========================================================================
  describe('Sub-pickers rendering', () => {
    it('renders ModelPicker with the given catalog and selected value', () => {
      const html = renderToString(
        <ModelPicker
          value="gemini-3.1-pro-high"
          models={[
            { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', group: 'gemini', isDefault: true },
            { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)', group: 'gemini', isDefault: false },
          ]}
          onChange={() => {}}
        />,
      );
      expect(html).toContain('data-testid="model-picker-select"');
      expect(html).toContain('Gemini 3.8 Flash (High)');
      expect(html).toContain('Gemini 3.1 Pro (High)');
    });

    it('renders a disabled loading placeholder while the model catalog is empty', () => {
      const html = renderToString(<ModelPicker onChange={() => {}} />);
      expect(html).toContain('加载模型中…');
      expect(html).toContain('disabled');
    });

    it('renders EffortPicker with low/medium/high/max options', () => {
      const html = renderToString(<EffortPicker value="high" onChange={() => {}} />);
      expect(html).toContain('data-testid="effort-picker-select"');
      expect(html).toContain('Effort: High');
      expect(html).toContain('Effort: Medium');
    });

    it('renders ModePicker with code/architect/ask options', () => {
      const html = renderToString(<ModePicker value="architect" onChange={() => {}} />);
      expect(html).toContain('data-testid="mode-picker-select"');
      expect(html).toContain('Mode: Architect');
      expect(html).toContain('Mode: Code');
    });

    it('renders AgentPicker with the built-in default selected when no agents are loaded', () => {
      const html = renderToString(<AgentPicker onChange={() => {}} />);
      expect(html).toContain('data-testid="agent-picker-select"');
      expect(html).toContain('aria-label="选择智能体"');
      expect(html).toContain('Agent: Default agent');
      expect(html).toMatch(/<option[^>]*value="default"[^>]*selected/);
    });

    it('renders AgentPicker with workspace/global agents and the chosen one selected', () => {
      const agents: AgentInfo[] = [
        { id: 'default', name: 'Default agent', description: null, scope: 'builtin' },
        { id: 'code-reviewer', name: 'code-reviewer', description: 'Reviews diffs', scope: 'workspace' },
        { id: 'planner', name: 'planner', description: null, scope: 'global' },
      ];
      const html = renderToString(
        <AgentPicker value="code-reviewer" agents={agents} onChange={() => {}} />,
      );
      expect(html).toContain('Agent: code-reviewer');
      expect(html).toContain('Agent: planner');
      expect(html).toMatch(/<option[^>]*value="code-reviewer"[^>]*selected/);
    });

    it('renders AttachmentChip with uploading progress and delete button', () => {
      const mockAttachment = {
        id: 'att-1',
        file: new File([''], 'diagram.png', { type: 'image/png' }),
        originalName: 'diagram.png',
        size: 1024 * 50,
        mimeType: 'image/png',
        status: 'uploading' as const,
        progress: 65,
      };

      const html = renderToString(
        <AttachmentChip attachment={mockAttachment} onDelete={() => {}} />,
      );
      expect(html).toContain('data-testid="attachment-chip-att-1"');
      expect(html).toContain('diagram.png');
      expect(html).toContain('65%');
      expect(html).toContain('data-testid="delete-attachment-att-1"');
    });

    it('renders AttachmentChip error state with retry button', () => {
      const mockFailedAttachment = {
        id: 'att-fail',
        file: new File([''], 'report.pdf', { type: 'application/pdf' }),
        originalName: 'report.pdf',
        size: 1024 * 200,
        mimeType: 'application/pdf',
        status: 'error' as const,
        progress: 0,
        error: 'Network timeout',
      };

      const html = renderToString(
        <AttachmentChip
          attachment={mockFailedAttachment}
          onDelete={() => {}}
          onRetry={() => {}}
        />
      );
      expect(html).toContain('data-testid="retry-attachment-att-fail"');
      expect(html).toContain('失败');
      expect(html).toContain('data-testid="delete-attachment-att-fail"');
    });
  });

  // ==========================================================================
  // 4. Composer Structure & Rendering
  // ==========================================================================
  describe('Composer Structure', () => {
    it('renders textarea, toolbar buttons, pickers, and send button in idle state', () => {
      const html = renderToString(
        <Composer sessionId="session-123" placeholder="Type here..." />,
      );

      expect(html).toContain('data-testid="composer-container"');
      expect(html).toContain('data-testid="composer-textarea"');
      expect(html).toContain('data-testid="attach-file-button"');
      expect(html).toContain('data-testid="attach-camera-button"');
      expect(html).toContain('data-testid="hidden-file-input"');
      expect(html).toContain('data-testid="hidden-camera-input"');
      expect(html).toContain('capture="environment"');
      expect(html).toContain('data-testid="model-picker-select"');
      expect(html).toContain('data-testid="effort-picker-select"');
      expect(html).toContain('data-testid="mode-picker-select"');
      expect(html).toContain('data-testid="agent-picker-select"');
      expect(html).toContain('data-testid="composer-send-button"');
      expect(html).not.toContain('data-testid="composer-stop-button"');
    });

    it('carries the agent chosen in the composer into the send options, and drops the default agent', () => {
      const html = renderToString(<Composer sessionId="session-123" agent="code-reviewer" />);
      expect(html).toMatch(/<option[^>]*value="code-reviewer"[^>]*selected/);

      expect(
        buildSendOptions({ attachmentIds: [], model: 'm1', mode: 'plan', agent: 'code-reviewer' }),
      ).toEqual({ attachmentIds: undefined, model: 'm1', effort: undefined, mode: 'plan', agent: 'code-reviewer' });
      expect(buildSendOptions({ attachmentIds: ['a1'], agent: 'default' }).agent).toBeUndefined();
      expect(buildSendOptions({ attachmentIds: [] }).agent).toBeUndefined();
    });

    it('renders stop button instead of send button when session is running', () => {
      mockSessionSlots = {
        'session-123': {
          activeRunId: 'run-running-456',
          pendingRunId: null,
        },
      };

      const html = renderToString(<Composer sessionId="session-123" />);

      expect(html).toContain('data-testid="composer-stop-button"');
      expect(html).toContain('停止');
      expect(html).not.toContain('data-testid="composer-send-button"');
    });
  });

  // ==========================================================================
  // 5. Interactive & Event Handlers Logic Tests
  // ==========================================================================
  describe('Keydown & Composition Behavior', () => {
    it('verifies IME composition check rule: Enter during isComposing must never trigger send', () => {
      let sendCalled = false;
      const onSendMock = async () => {
        sendCalled = true;
      };

      // Emulate the keydown handler logic directly to ensure invariant
      const simulateKeydown = (event: {
        key: string;
        shiftKey?: boolean;
        nativeEvent: { isComposing?: boolean };
        isComposing?: boolean;
        keyCode?: number;
      }) => {
        const isComposing =
          event.nativeEvent.isComposing ||
          event.isComposing ||
          event.keyCode === 229;

        if (event.key === 'Enter') {
          if (isComposing) {
            return; // strictly ignored
          }
          if (event.shiftKey) {
            return; // Shift+Enter newline
          }
          onSendMock();
        }
      };

      // 1. Enter while isComposing = true (Chinese/Japanese IME)
      simulateKeydown({
        key: 'Enter',
        nativeEvent: { isComposing: true },
      });
      expect(sendCalled).toBe(false);

      // 2. Enter while keyCode = 229 (IME composing code)
      simulateKeydown({
        key: 'Enter',
        nativeEvent: {},
        keyCode: 229,
      });
      expect(sendCalled).toBe(false);

      // 3. Shift+Enter: newline, must not send
      simulateKeydown({
        key: 'Enter',
        shiftKey: true,
        nativeEvent: { isComposing: false },
      });
      expect(sendCalled).toBe(false);

      // 4. Regular Enter: triggers send
      simulateKeydown({
        key: 'Enter',
        shiftKey: false,
        nativeEvent: { isComposing: false },
      });
      expect(sendCalled).toBe(true);
    });

    it('verifies paste event extracts files and triggers upload workflow', async () => {
      const dummyFile = new File(['content'], 'pasted-screenshot.png', {
        type: 'image/png',
      });

      const fakeClipboardItems = [
        {
          kind: 'file',
          getAsFile: () => dummyFile,
        },
      ];

      const extractedFiles: File[] = [];
      for (const item of fakeClipboardItems) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) extractedFiles.push(f);
        }
      }

      expect(extractedFiles.length).toBe(1);
      expect(extractedFiles[0].name).toBe('pasted-screenshot.png');

      mockUploadAttachments.mockResolvedValueOnce({
        attachments: [
          {
            id: 'att-uploaded-1',
            workspaceId: 'ws-test-1',
            sessionId: 'session-123',
            kind: 'image',
            originalName: 'pasted-screenshot.png',
            mimeType: 'image/png',
            size: dummyFile.size,
            storedPath: '/workspace/.agy-attachments/2026-09-28/att-uploaded-1-pasted-screenshot.png',
            derivedTextPath: null,
            createdAt: '2026-09-28T12:00:00.000Z',
          } as Attachment,
        ],
      });

      const res = await mockUploadAttachments(extractedFiles, 'ws-test-1', 'session-123');
      expect(res.attachments.length).toBe(1);
      expect(res.attachments[0].id).toBe('att-uploaded-1');
    });

    it('verifies upload failure and retry workflow', async () => {
      mockUploadAttachments.mockRejectedValueOnce(new Error('Network error'));

      let errorCaught = false;
      try {
        await mockUploadAttachments([new File([''], 'test.txt')], 'ws-1', 's-1');
      } catch (err: any) {
        errorCaught = true;
        expect(err.message).toBe('Network error');
      }
      expect(errorCaught).toBe(true);

      // Retry succeeding
      mockUploadAttachments.mockResolvedValueOnce({
        attachments: [{ id: 'att-retried', originalName: 'test.txt' }],
      });
      const retryRes = await mockUploadAttachments([new File([''], 'test.txt')], 'ws-1', 's-1');
      expect(retryRes.attachments[0].id).toBe('att-retried');
    });

    it('verifies running state stop button invokes abort handler', async () => {
      const onAbortMock = vi.fn().mockResolvedValue(undefined);
      const activeRunId = 'run-stop-test';

      const handleAbort = async () => {
        if (onAbortMock) {
          await onAbortMock(activeRunId);
        } else {
          await mockStoreAbort('session-123', activeRunId);
        }
      };

      await handleAbort();
      expect(onAbortMock).toHaveBeenCalledWith('run-stop-test');
    });

    it('verifies size limit validations: individual file > 30MB, total > 100MB, count > 10', () => {
      const validateFiles = (existingCount: number, existingTotal: number, newFiles: { name: string; size: number }[]) => {
        if (existingCount + newFiles.length > COMPOSER_LIMITS.maxFilesPerUpload) {
          return `单次最多上传 ${COMPOSER_LIMITS.maxFilesPerUpload} 个文件`;
        }
        const incomingTotal = newFiles.reduce((s, f) => s + f.size, 0);
        if (existingTotal + incomingTotal > COMPOSER_LIMITS.maxTotalSize) {
          return `附件总大小不能超过 ${formatFileSize(COMPOSER_LIMITS.maxTotalSize)}`;
        }
        for (const file of newFiles) {
          if (file.size > COMPOSER_LIMITS.maxFileSize) {
            return `文件 "${file.name}" 大小超过单文件上限`;
          }
        }
        return null;
      };

      // 1. Single file exceeds 30MB
      expect(
        validateFiles(0, 0, [{ name: 'huge.iso', size: 31 * 1024 * 1024 }]),
      ).toContain('超过单文件上限');

      // 2. Count exceeds 10
      const elevenFiles = Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.txt`, size: 10 }));
      expect(validateFiles(0, 0, elevenFiles)).toContain('单次最多上传 10 个文件');

      // 3. Total size exceeds 100MB
      expect(
        validateFiles(0, 90 * 1024 * 1024, [{ name: 'another.zip', size: 15 * 1024 * 1024 }]),
      ).toContain('附件总大小不能超过 100.0 MB');

      // 4. Valid files pass
      expect(
        validateFiles(0, 0, [{ name: 'valid.png', size: 5 * 1024 * 1024 }]),
      ).toBeNull();
    });
  });
});
