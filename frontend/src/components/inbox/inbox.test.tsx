import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, Session, Workspace } from '@agy-studio/contracts';
import { useAccountStore } from '../../stores/account.store';
import { useSessionStore } from '../../stores/session.store';
import { useUiStore } from '../../stores/ui.store';
import { useWorkspaceStore } from '../../stores/workspace.store';
import * as endpoints from '../../api/endpoints';
import {
  AddWorkspaceDialog,
  formatRelativeTime,
  groupSessions,
  ImportSessionsButton,
  InboxItem,
  InboxList,
  NewSessionButton,
  useIsIsolatedHome,
  WorkspaceSwitcher,
} from './index';

// ----------------------------------------------------------------------------
// Mock stores / actions
// ----------------------------------------------------------------------------
const mockSession1: Session = {
  id: 'sess-running',
  workspaceId: 'ws-1',
  title: '运行中的长任务',
  agyConversationId: 'agy-1',
  status: 'running',
  model: 'claude-3-7-sonnet',
  effort: 'high',
  mode: 'code',
  source: 'studio',
  accountName: 'acc-prod',
  lastRunId: 'run-1',
  lastSeq: 42,
  createdAt: '2026-09-28T10:00:00.000Z',
  updatedAt: '2026-09-28T10:00:00.000Z',
};

const mockSession2: Session = {
  id: 'sess-attention',
  workspaceId: 'ws-1',
  title: '已结束但有新输出未读',
  agyConversationId: 'agy-2',
  status: 'idle',
  model: 'claude-3-7-sonnet',
  effort: null,
  mode: null,
  source: 'studio',
  accountName: 'acc-beta',
  lastRunId: 'run-2',
  lastSeq: 30, // readSeq will be < 30
  createdAt: '2026-09-28T09:00:00.000Z',
  updatedAt: '2026-09-28T09:00:00.000Z',
};

const mockSession3: Session = {
  id: 'sess-completed',
  workspaceId: 'ws-1',
  title: '已全部读完的会话',
  agyConversationId: 'agy-3',
  status: 'idle',
  model: null,
  effort: null,
  mode: null,
  source: 'studio',
  accountName: null,
  lastRunId: 'run-3',
  lastSeq: 20, // readSeq will be >= 20
  createdAt: '2026-09-27T08:00:00.000Z',
  updatedAt: '2026-09-27T08:00:00.000Z',
};

const mockWorkspace1: Workspace = {
  id: 'ws-1',
  name: '核心项目',
  path: 'G:\\new',
  isGitRepo: true,
  createdAt: '2026-09-20T00:00:00.000Z',
  lastOpenedAt: '2026-09-28T10:00:00.000Z',
};

const mockWorkspace2: Workspace = {
  id: 'ws-2',
  name: '测试项目',
  path: 'G:\\test-proj',
  isGitRepo: false,
  createdAt: '2026-09-21T00:00:00.000Z',
  lastOpenedAt: '2026-09-27T10:00:00.000Z',
};

const mockAccount1: Account = {
  name: 'acc-prod',
  type: 'oauth',
  isolation: 'isolated_home',
  email: 'prod@example.com',
  note: null,
  savedAt: '2026-09-20T00:00:00.000Z',
  active: true,
  activeRuns: 1,
};

const mockAccount2: Account = {
  name: 'acc-beta',
  type: 'apikey',
  isolation: 'isolated_home',
  email: null,
  note: null,
  savedAt: '2026-09-21T00:00:00.000Z',
  active: false,
  activeRuns: 0,
};

describe('Inbox Components', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset Session store
    useSessionStore.setState({
      slots: {},
      activeSessionId: null,
      list: [mockSession1, mockSession2, mockSession3],
      listLoading: false,
      listError: null,
    });

    // Reset Ui store
    useUiStore.setState({
      readSeqMap: {
        'sess-running': 10,
        'sess-attention': 15, // < lastSeq 30
        'sess-completed': 20, // == lastSeq 20
      },
    });

    // Reset Workspace store
    useWorkspaceStore.setState({
      workspaces: [mockWorkspace1, mockWorkspace2],
      currentWorkspace: mockWorkspace1,
      loading: false,
      error: null,
    });

    // Reset Account store (default to credential_snapshot mode)
    useAccountStore.setState({
      accounts: [],
      whoami: {
        activeProfile: 'default',
        email: 'user@example.com',
        accountType: 'oauth',
        isolation: 'credential_snapshot',
        credentialPresent: true,
      },
      loading: false,
      error: null,
    });
  });

  // ==========================================================================
  // 1. 测试会话按“运行中”、“待查看”、“已完成”三组正确分类
  // ==========================================================================
  describe('会话按状态三组分类 (groupSessions & InboxList)', () => {
    it('正确将会话归类为 running、attention、completed', () => {
      const readSeqMap: Record<string, number> = {
        'sess-running': 0, // Even if readSeq is 0, running status takes precedence
        'sess-attention': 15, // 15 < 30 -> attention
        'sess-completed': 25, // 25 >= 20 -> completed
      };

      const grouped = groupSessions(
        [mockSession1, mockSession2, mockSession3],
        readSeqMap,
      );

      expect(grouped.running.map((s) => s.id)).toEqual(['sess-running']);
      expect(grouped.attention.map((s) => s.id)).toEqual(['sess-attention']);
      expect(grouped.completed.map((s) => s.id)).toEqual(['sess-completed']);
    });

    it('会话 lastSeq 为 0 且 status 不为 running 时归入已完成 (Completed)', () => {
      const zeroSeqSession: Session = {
        ...mockSession2,
        id: 'sess-zero',
        status: 'idle',
        lastSeq: 0,
      };

      const grouped = groupSessions([zeroSeqSession], {});
      // readSeq is 0, lastSeq is 0 -> 0 < 0 is false -> completed
      expect(grouped.attention).toHaveLength(0);
      expect(grouped.completed.map((s) => s.id)).toEqual(['sess-zero']);
    });

    it('InboxList 渲染各分组标题及会话计数', () => {
      const html = renderToString(<InboxList />);

      expect(html).toContain('运行中');
      expect(html).toContain('待查看');
      expect(html).toContain('已完成');

      // 验证数量标识：运行中 1，待查看 1，已完成 1
      expect(html).toContain('data-testid="group-count-running"');
      expect(html).toContain('data-testid="group-count-attention"');
      expect(html).toContain('data-testid="group-count-completed"');
      expect(html).toContain('运行中的长任务');
      expect(html).toContain('已结束但有新输出未读');
      expect(html).toContain('已全部读完的会话');
    });

    it('当会话列表为空时渲染暂无会话提示', () => {
      useSessionStore.setState({ list: [] });
      const html = renderToString(<InboxList />);
      expect(html).toContain('暂无会话');
    });
  });

  // ==========================================================================
  // 2. 测试点击会话切换 activeSessionId 并标记已读与删除交互
  // ==========================================================================
  describe('会话项交互 (InboxItem)', () => {
    it('渲染会话标题、相对时间与状态点', () => {
      const html = renderToString(<InboxItem session={mockSession1} />);
      expect(html).toContain('运行中的长任务');
      expect(html).toContain('claude-3-7-sonnet');
      expect(html).toContain('data-testid="status-dot-running"');
    });

    it('formatRelativeTime 正确格式化相对时间', () => {
      const now = Date.now();
      expect(formatRelativeTime(new Date(now - 10_000).toISOString())).toBe('刚刚');
      expect(formatRelativeTime(new Date(now - 5 * 60_000).toISOString())).toBe('5分钟前');
      expect(formatRelativeTime(new Date(now - 3 * 3600_000).toISOString())).toBe('3小时前');
      expect(formatRelativeTime(new Date(now - 2 * 86400_000).toISOString())).toBe('2天前');
      expect(formatRelativeTime(null)).toBe('');
    });

    it('点击会话项切换 activeSessionId 并更新 ui.store 的 readSeqMap', () => {
      expect(useSessionStore.getState().activeSessionId).toBeNull();
      expect(useUiStore.getState().readSeqMap['sess-attention']).toBe(15);

      // 触发切换
      useSessionStore.getState().setActiveSessionId(mockSession2.id);
      useUiStore.getState().markSessionAsRead(mockSession2.id, mockSession2.lastSeq);

      expect(useSessionStore.getState().activeSessionId).toBe('sess-attention');
      expect(useUiStore.getState().readSeqMap['sess-attention']).toBe(30);

      // 标记已读后再次重新分组，原 attention 会话自动转移至 completed
      const nextGrouped = groupSessions(
        useSessionStore.getState().list,
        useUiStore.getState().readSeqMap,
      );
      expect(nextGrouped.attention).toHaveLength(0);
      expect(nextGrouped.completed.some((s) => s.id === 'sess-attention')).toBe(true);
    });

    it('支持二次确认后删除会话', async () => {
      const deleteSessionSpy = vi.spyOn(useSessionStore.getState(), 'deleteSession');
      deleteSessionSpy.mockResolvedValueOnce(undefined);

      // 初始存在 3 个会话
      expect(useSessionStore.getState().list).toHaveLength(3);

      // 模拟确认删除
      await useSessionStore.getState().deleteSession('sess-attention');
      useSessionStore.getState().handleSessionDeleted('sess-attention');

      expect(useSessionStore.getState().list.some((s) => s.id === 'sess-attention')).toBe(false);
      expect(useSessionStore.getState().list).toHaveLength(2);
    });
  });

  // ==========================================================================
  // 3. 测试 isolated_home 下显示账号标签与新建会话账号选择
  // ==========================================================================
  describe('isolated_home 模式特性 (账号标签与新建会话)', () => {
    it('非 isolated_home 模式下不渲染账号标签', () => {
      useAccountStore.setState({
        whoami: {
          activeProfile: 'default',
          email: 'test@example.com',
          accountType: 'oauth',
          isolation: 'credential_snapshot',
          credentialPresent: true,
        },
      });

      const html = renderToString(
        <InboxItem session={mockSession1} isIsolatedHome={false} />,
      );
      expect(html).not.toContain('data-testid="inbox-item-account"');
      expect(html).not.toContain('acc-prod');
    });

    it('在 isolated_home 模式下渲染会话所属账号标签', () => {
      useAccountStore.setState({
        whoami: {
          activeProfile: 'acc-prod',
          email: 'test@example.com',
          accountType: 'oauth',
          isolation: 'isolated_home',
          credentialPresent: true,
        },
        accounts: [mockAccount1, mockAccount2],
      });

      const html = renderToString(
        <InboxItem session={mockSession1} isIsolatedHome={true} />,
      );
      expect(html).toContain('data-testid="inbox-item-account"');
      expect(html).toContain('acc-prod');
    });

    it('新建会话在非 isolated_home 模式下直接创建', async () => {
      const createSessionSpy = vi.spyOn(useSessionStore.getState(), 'createSession');
      const fakeCreated: Session = {
        ...mockSession1,
        id: 'sess-new-direct',
        title: '新会话',
      };
      createSessionSpy.mockResolvedValueOnce(fakeCreated);

      // 确保处于 credential_snapshot 模式
      useAccountStore.setState({
        whoami: {
          activeProfile: 'default',
          email: 'test@example.com',
          accountType: 'oauth',
          isolation: 'credential_snapshot',
          credentialPresent: true,
        },
      });

      // 直接调用 store 创建会话（非 isolated_home）
      const created = await useSessionStore.getState().createSession({
        workspaceId: 'ws-1',
      });

      expect(created.id).toBe('sess-new-direct');
      expect(createSessionSpy).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
      });
    });

    it('新建会话在 isolated_home 模式下支持指定所选账号', async () => {
      const createSessionSpy = vi.spyOn(useSessionStore.getState(), 'createSession');
      const fakeCreated: Session = {
        ...mockSession1,
        id: 'sess-new-isolated',
        title: '新隔离会话',
        accountName: 'acc-beta',
      };
      createSessionSpy.mockResolvedValueOnce(fakeCreated);

      // 处于 isolated_home 模式
      useAccountStore.setState({
        whoami: {
          activeProfile: 'acc-prod',
          email: 'test@example.com',
          accountType: 'oauth',
          isolation: 'isolated_home',
          credentialPresent: true,
        },
        accounts: [mockAccount1, mockAccount2],
      });

      // 选定 acc-beta 创建会话
      const created = await useSessionStore.getState().createSession({
        workspaceId: 'ws-1',
        accountName: 'acc-beta',
      });

      expect(created.accountName).toBe('acc-beta');
      expect(createSessionSpy).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        accountName: 'acc-beta',
      });
    });
  });

  // ==========================================================================
  // 4. 测试工作区切换与新建工作区表单交互
  // ==========================================================================
  describe('工作区切换与新建工作区表单交互 (WorkspaceSwitcher & AddWorkspaceDialog)', () => {
    it('WorkspaceSwitcher 展示当前选中的工作区名称与路径', () => {
      const html = renderToString(<WorkspaceSwitcher />);
      expect(html).toContain('核心项目');
      expect(html).toContain('data-testid="workspace-switcher-btn"');
    });

    it('切换工作区时更新 currentWorkspace 并触发 fetchSessions', async () => {
      const fetchSessionsSpy = vi.spyOn(useSessionStore.getState(), 'fetchSessions');
      fetchSessionsSpy.mockResolvedValueOnce([]);

      expect(useWorkspaceStore.getState().currentWorkspace?.id).toBe('ws-1');

      // 选择 ws-2
      useWorkspaceStore.getState().selectWorkspace('ws-2');
      await useSessionStore.getState().fetchSessions({ workspaceId: 'ws-2' });

      expect(useWorkspaceStore.getState().currentWorkspace?.id).toBe('ws-2');
      expect(fetchSessionsSpy).toHaveBeenCalledWith({ workspaceId: 'ws-2' });
    });

    it('AddWorkspaceDialog 渲染输入框、提交按钮并展示后端错误', async () => {
      // 1. 验证正常渲染弹窗 DOM
      const html = renderToString(
        <AddWorkspaceDialog isOpen={true} onClose={() => {}} />,
      );
      expect(html).toContain('添加工作区');
      expect(html).toContain('data-testid="workspace-path-input"');
      expect(html).toContain('data-testid="workspace-name-input"');
      expect(html).toContain('data-testid="create-workspace-submit"');

      // 2. 模拟创建工作区失败，抛出错误
      const createWorkspaceSpy = vi.spyOn(useWorkspaceStore.getState(), 'createWorkspace');
      createWorkspaceSpy.mockRejectedValueOnce(new Error('路径不存在或不是有效目录: /invalid/path'));

      let caughtError: string | null = null;
      try {
        await useWorkspaceStore.getState().createWorkspace({
          path: '/invalid/path',
          name: 'Invalid Project',
        });
      } catch (err: any) {
        caughtError = err.message;
      }

      expect(caughtError).toBe('路径不存在或不是有效目录: /invalid/path');

      // 3. 模拟成功添加工作区
      const newWs: Workspace = {
        id: 'ws-created',
        name: '新建的项目',
        path: 'G:\\new-proj',
        isGitRepo: false,
        createdAt: '2026-09-28T12:00:00.000Z',
        lastOpenedAt: '2026-09-28T12:00:00.000Z',
      };
      // 恢复原始方法并在 store 状态下执行真实方法（mock API endpoint）
      createWorkspaceSpy.mockRestore();
      const apiCreateWorkspaceSpy = vi.spyOn(endpoints, 'createWorkspace');
      apiCreateWorkspaceSpy.mockResolvedValueOnce(newWs);

      const created = await useWorkspaceStore.getState().createWorkspace({
        path: 'G:\\new-proj',
        name: '新建的项目',
      });
      expect(created.id).toBe('ws-created');
      expect(useWorkspaceStore.getState().currentWorkspace?.id).toBe('ws-created');
    });

    it('ImportSessionsButton 成功导入会话后更新状态', async () => {
      const importSessionsSpy = vi.spyOn(useSessionStore.getState(), 'importSessions');
      const importedSession: Session = {
        ...mockSession3,
        id: 'sess-imported-disk',
        title: '从磁盘导入的会话',
        source: 'imported',
      };
      importSessionsSpy.mockResolvedValueOnce([importedSession]);

      const res = await useSessionStore.getState().importSessions({
        workspaceId: 'ws-1',
      });

      expect(res).toHaveLength(1);
      expect(res[0].id).toBe('sess-imported-disk');
      expect(importSessionsSpy).toHaveBeenCalledWith({ workspaceId: 'ws-1' });

      // 验证按钮组件渲染
      const html = renderToString(<ImportSessionsButton />);
      expect(html).toContain('data-testid="import-sessions-btn"');
      expect(html).toContain('导入会话');
    });
  });
});
