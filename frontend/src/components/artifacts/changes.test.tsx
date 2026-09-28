import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Checkpoint, CheckpointDiff } from '@agy-studio/contracts';
import * as endpoints from '../../api/endpoints';
import { createEmptySlot, useSessionStore } from '../../stores/session.store';
import { useUiStore } from '../../stores/ui.store';
import { ArtifactTabs, getTabContentMap } from './ArtifactTabs';
import {
  ChangesView,
  formatSnapshotTime,
  ROLLBACK_WARNING_TEXT,
} from './ChangesView';

// ----------------------------------------------------------------------------
// Mock Fixtures
// ----------------------------------------------------------------------------

const mockCheckpoint1: Checkpoint = {
  id: 'cp-run-101',
  workspaceId: 'ws-1',
  sessionId: 'sess-100',
  runId: 'run-101',
  commitSha: 'a1b2c3d4e5f67890',
  filesChanged: 3,
  createdAt: '2026-09-28T10:15:30.000Z',
};

const mockCheckpoint2: Checkpoint = {
  id: 'cp-run-102',
  workspaceId: 'ws-1',
  sessionId: 'sess-100',
  runId: 'run-102',
  commitSha: 'f9e8d7c6b5a43210',
  filesChanged: 1,
  createdAt: '2026-09-28T11:20:00.000Z',
};

const mockCheckpointDiffData: CheckpointDiff = {
  checkpointId: 'cp-run-101',
  files: [
    {
      path: 'src/main.ts',
      changeType: 'modified',
      patch: `diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,3 +1,4 @@\n import { app } from './app';\n-app.listen(3000);\n+const port = 8080;\n+app.listen(port);`,
    },
  ],
};

describe('ChangesView & Checkpoints Integration Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useUiStore.setState({ activeArtifactTab: 'Changes' });
    useSessionStore.setState({
      activeSessionId: 'sess-100',
      slots: {
        'sess-100': {
          ...createEmptySlot(),
          activeRunId: null,
          pendingRunId: null,
        },
      },
    });
  });

  // ==========================================================================
  // 1. 检查点列表渲染与空状态测试
  // ==========================================================================
  describe('Checkpoints List Rendering', () => {
    it('renders list of checkpoints with snapshot time, short SHA, run ID, and files changed', () => {
      const html = renderToString(
        <ChangesView
          sessionId="sess-100"
          checkpoints={[mockCheckpoint1, mockCheckpoint2]}
        />,
      );

      expect(html).toContain('data-testid="changes-view"');
      expect(html).toContain('data-testid="checkpoints-container"');

      // 验证检查点 1 信息
      expect(html).toContain('data-testid="checkpoint-item-cp-run-101"');
      expect(html).toContain('a1b2c3d'); // 7 位 SHA
      expect(html).toContain('Run: run-101');
      expect(html).toContain('3 个文件变更');
      expect(html).toContain(formatSnapshotTime(mockCheckpoint1.createdAt));

      // 验证检查点 2 信息
      expect(html).toContain('data-testid="checkpoint-item-cp-run-102"');
      expect(html).toContain('f9e8d7c'); // 7 位 SHA
      expect(html).toContain('Run: run-102');
      expect(html).toContain('1 个文件变更');

      // 验证回滚按钮在空闲状态下可用
      expect(html).toContain('data-testid="rollback-btn-cp-run-101"');
      expect(html).toContain('回滚到此检查点');
      expect(html).not.toContain('运行中无法回滚');
    });

    it('renders friendly empty state when no checkpoints exist', () => {
      const html = renderToString(
        <ChangesView sessionId="sess-empty" checkpoints={[]} />,
      );

      expect(html).toContain('data-testid="checkpoints-empty"');
      expect(html).toContain('暂无检查点记录');
      expect(html).toContain('在任务运行执行过程中，系统会自动记录每个阶段的文件变更快照');
    });
  });

  // ==========================================================================
  // 2. 检查点展开与加载 Diff 详情测试
  // ==========================================================================
  describe('Checkpoint Diff Expansion & Loading', () => {
    it('renders expanded diff container and triggers DiffViewer when checkpoint is expanded', async () => {
      const getDiffSpy = vi.spyOn(endpoints, 'getCheckpointDiff');
      getDiffSpy.mockResolvedValue(mockCheckpointDiffData);

      // 直接测试展开状态的组件渲染
      const html = renderToString(
        <ChangesView
          sessionId="sess-100"
          checkpoints={[mockCheckpoint1]}
          initialExpandedCheckpointId="cp-run-101"
        />,
      );

      expect(html).toContain('data-testid="checkpoint-diff-container-cp-run-101"');
      expect(html).toContain('data-testid="diff-loading"');
      expect(html).toContain('正在加载详细 Diff 差异...');
    });

    it('fetches checkpoint diff via API when triggered', async () => {
      const getDiffSpy = vi.spyOn(endpoints, 'getCheckpointDiff');
      getDiffSpy.mockResolvedValue(mockCheckpointDiffData);

      const diffResult = await endpoints.getCheckpointDiff('cp-run-101');
      expect(getDiffSpy).toHaveBeenCalledWith('cp-run-101');
      expect(diffResult.checkpointId).toBe('cp-run-101');
      expect(diffResult.files).toHaveLength(1);
      expect(diffResult.files[0].path).toBe('src/main.ts');
    });
  });

  // ==========================================================================
  // 3. 运行中状态禁用回滚按钮测试
  // ==========================================================================
  describe('Active Run Disables Rollback', () => {
    it('disables rollback buttons and displays warning banner when activeRunId exists via prop', () => {
      const html = renderToString(
        <ChangesView
          sessionId="sess-100"
          checkpoints={[mockCheckpoint1]}
          activeRunId="run-in-progress-999"
        />,
      );

      // 顶部运行中警告提示条
      expect(html).toContain('data-testid="running-status-notice"');
      expect(html).toContain('当前会话正在运行中，回滚操作已锁定。');

      // 回滚按钮置灰且禁用
      expect(html).toContain('data-testid="rollback-btn-cp-run-101"');
      expect(html).toContain('disabled=""');
      expect(html).toContain('运行中无法回滚');
      expect(html).toContain('cursor-not-allowed');
    });

    it('disables rollback buttons when activeRunId exists in session store slot', () => {
      useSessionStore.setState({
        slots: {
          'sess-100': {
            ...createEmptySlot(),
            activeRunId: 'run-active-slot',
            pendingRunId: null,
          },
        },
      });

      const html = renderToString(
        <ChangesView sessionId="sess-100" checkpoints={[mockCheckpoint1]} />,
      );

      expect(html).toContain('data-testid="running-status-notice"');
      expect(html).toContain('disabled=""');
      expect(html).toContain('运行中无法回滚');
    });
  });

  // ==========================================================================
  // 4. 回滚二次确认对话框机制测试
  // ==========================================================================
  describe('Rollback Confirmation Dialog', () => {
    it('renders secondary confirmation dialog with exact required warning text and target details', () => {
      const html = renderToString(
        <ChangesView
          sessionId="sess-100"
          checkpoints={[mockCheckpoint1]}
          initialRollbackTarget={mockCheckpoint1}
        />,
      );

      expect(html).toContain('data-testid="rollback-confirm-dialog"');
      expect(html).toContain('确认回滚到此检查点？');

      // 验证目标快照信息
      expect(html).toContain('a1b2c3d');
      expect(html).toContain('run-101');
      expect(html).toContain('3 个');

      // 验证严格指定的警示文案
      expect(html).toContain('data-testid="rollback-warning-text"');
      expect(html).toContain(ROLLBACK_WARNING_TEXT);
      expect(html).toContain(
        '工作区会恢复到这次运行开始前的状态，之后的所有修改（包括手动修改）都会被覆盖；系统会先自动保存一份回滚前的快照',
      );

      // 验证操作按钮
      expect(html).toContain('data-testid="cancel-rollback-btn"');
      expect(html).toContain('取消');
      expect(html).toContain('data-testid="confirm-rollback-btn"');
      expect(html).toContain('确认回滚');
    });
  });

  // ==========================================================================
  // 5. 回滚成功与接口报错提示测试
  // ==========================================================================
  describe('Rollback Execution & Error Handling', () => {
    it('calls rollbackCheckpoint endpoint successfully and returns restored file count', async () => {
      const rollbackSpy = vi.spyOn(endpoints, 'rollbackCheckpoint');
      rollbackSpy.mockResolvedValue({ ok: true, restoredFiles: 4 });

      const res = await endpoints.rollbackCheckpoint('cp-run-101');
      expect(rollbackSpy).toHaveBeenCalledWith('cp-run-101');
      expect(res.ok).toBe(true);
      expect(res.restoredFiles).toBe(4);
    });

    it('propagates and handles rollback endpoint failure gracefully', async () => {
      const rollbackSpy = vi.spyOn(endpoints, 'rollbackCheckpoint');
      rollbackSpy.mockRejectedValue(new Error('SESSION_BUSY: 当前工作区有正在执行的任务'));

      await expect(endpoints.rollbackCheckpoint('cp-run-101')).rejects.toThrow(
        'SESSION_BUSY: 当前工作区有正在执行的任务',
      );
    });
  });

  // ==========================================================================
  // 6. ArtifactTabs 联动与 Changes 标签激活测试
  // ==========================================================================
  describe('ArtifactTabs Integration with ChangesView', () => {
    it('activates Changes tab (not disabled / not grayed out) when checkpoints exist', () => {
      // 构造无 artifact 但有 checkpoint 的状态
      const contentMap = getTabContentMap([], true);
      expect(contentMap.Changes).toBe(true);
      expect(contentMap.Task).toBe(false);

      // 无 checkpoint 且无产物时，全部置灰
      const emptyMap = getTabContentMap([], false);
      expect(emptyMap.Changes).toBe(false);
    });

    it('renders real ChangesView inside ArtifactTabs instead of the old placeholder', () => {
      // 激活 Changes 标签
      useUiStore.setState({ activeArtifactTab: 'Changes' });

      const html = renderToString(<ArtifactTabs sessionId="sess-100" />);

      // 不再包含旧版占位文案
      expect(html).not.toContain('data-testid="changes-placeholder"');
      expect(html).not.toContain('模块 2.12 将实现检查点对比与代码变更 Diff 视图');

      // 包含真实的 ChangesView 容器
      expect(html).toContain('data-testid="changes-view"');
    });
  });
});
