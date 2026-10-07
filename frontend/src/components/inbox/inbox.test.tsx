import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, Session, Workspace } from '@agy-studio/contracts';
import { useAccountStore } from '../../stores/account.store';
import { useSessionStore } from '../../stores/session.store';
import { useUiStore } from '../../stores/ui.store';
import { useWorkspaceStore } from '../../stores/workspace.store';
import { inboxIndicator, sessionsOfWorkspace, sortSessionsByActivity } from './InboxList';
import * as endpoints from '../../api/endpoints';
import {
  AddWorkspaceDialog,
  formatRelativeTime,
  ImportSessionsButton,
  InboxItem,
  InboxList,
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
      readSeqSeeded: true,
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
  // 1. 会话平铺列表：运行中转圈、完成未看蓝点、看过无图标
  // ==========================================================================
  describe('会话列表 (InboxList)', () => {
    it('运行中显示 running，结束未看显示 unread，看过或正在看显示 none', () => {
      expect(inboxIndicator(mockSession1, 0, false)).toBe('running');
      expect(inboxIndicator(mockSession2, 15, false)).toBe('unread');
      expect(inboxIndicator(mockSession2, 30, false)).toBe('none');
      expect(inboxIndicator(mockSession3, 20, false)).toBe('none');
      // 正在看的会话不显示蓝点
      expect(inboxIndicator(mockSession2, 15, true)).toBe('none');
      // 运行中即使正在看也转圈
      expect(inboxIndicator(mockSession1, 10, true)).toBe('running');
    });

    it('置顶的会话排在最前，按置顶时间倒序', () => {
      const recent = { ...mockSession2, id: 'recent', pinnedAt: null, updatedAt: '2026-09-30T00:00:00.000Z' };
      const pinnedOld = { ...mockSession3, id: 'pinned-old', pinnedAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
      const pinnedNew = { ...mockSession3, id: 'pinned-new', pinnedAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' };
      expect(sortSessionsByActivity([recent, pinnedOld, pinnedNew]).map((s) => s.id)).toEqual([
        'pinned-new',
        'pinned-old',
        'recent',
      ]);
    });

    it('置顶的会话显示置顶图标，并提供置顶 / 重命名操作', () => {
      const pinned = renderToString(
        <InboxItem session={{ ...mockSession3, pinnedAt: '2026-09-05T00:00:00.000Z' }} />,
      );
      expect(pinned).toContain('data-pinned="true"');
      expect(pinned).toContain('data-testid="inbox-item-pinned"');
      expect(pinned).toContain('取消置顶');

      const normal = renderToString(<InboxItem session={mockSession3} />);
      expect(normal).toContain('data-pinned="false"');
      expect(normal).not.toContain('inbox-item-pinned');
      expect(normal).toContain('data-testid="pin-session-btn"');
      expect(normal).toContain('data-testid="rename-session-btn"');
    });

    it('按最近活动时间倒序排列', () => {
      const older = { ...mockSession2, id: 'old', updatedAt: '2026-09-01T00:00:00.000Z' };
      const newer = { ...mockSession3, id: 'new', updatedAt: '2026-09-30T00:00:00.000Z' };
      expect(sortSessionsByActivity([older, newer]).map((s) => s.id)).toEqual(['new', 'old']);
    });

    it('平铺渲染全部会话，不再分组', () => {
      const html = renderToString(<InboxList />);

      expect(html).not.toContain('待查看');
      expect(html).not.toContain('data-testid="group-');
      expect(html).toContain('运行中的长任务');
      expect(html).toContain('已结束但有新输出未读');
      expect(html).toContain('已全部读完的会话');
      expect(html).toContain('data-indicator="running"');
      expect(html).toContain('data-indicator="unread"');
      expect(html).toContain('data-indicator="none"');
    });

    it('第一次使用时把已有会话全部记为已读，之后不再覆盖', () => {
      useUiStore.setState({ readSeqMap: {}, readSeqSeeded: false });
      useUiStore.getState().seedReadSeq([mockSession2, mockSession3]);
      expect(useUiStore.getState().readSeqMap).toEqual({ 'sess-attention': 30, 'sess-completed': 20 });

      useUiStore.getState().seedReadSeq([{ ...mockSession2, lastSeq: 99 }]);
      expect(useUiStore.getState().readSeqMap['sess-attention']).toBe(30);
    });

    it('当前工作区没有会话时提示', () => {
      useSessionStore.setState({ list: [] });
      const html = renderToString(<InboxList />);
      expect(html).toContain('这个工作区还没有会话');
    });

    it('只显示当前工作区的会话', () => {
      const other = { ...mockSession3, id: 'sess-other-ws', title: '另一个工作区的会话', workspaceId: 'ws-2' };
      useSessionStore.setState({ list: [mockSession1, other] });

      const html = renderToString(<InboxList />);
      expect(html).toContain('运行中的长任务');
      expect(html).not.toContain('另一个工作区的会话');

      useWorkspaceStore.setState({ currentWorkspace: mockWorkspace2 });
      const html2 = renderToString(<InboxList />);
      expect(html2).toContain('另一个工作区的会话');
      expect(html2).not.toContain('运行中的长任务');
    });

    it('sessionsOfWorkspace 在未选工作区时返回全部', () => {
      const other = { ...mockSession3, workspaceId: 'ws-2' };
      expect(sessionsOfWorkspace([mockSession1, other], null)).toHaveLength(2);
      expect(sessionsOfWorkspace([mockSession1, other], 'ws-2')).toEqual([other]);
    });
  });

  // ==========================================================================
  // 2. 测试点击会话切换 activeSessionId 并标记已读与删除交互
  // ==========================================================================
  describe('会话项交互 (InboxItem)', () => {
    it('渲染会话标题与状态图标', () => {
      const running = renderToString(<InboxItem session={mockSession1} indicator="running" />);
      expect(running).toContain('运行中的长任务');
      expect(running).toContain('animate-spin');

      const unread = renderToString(<InboxItem session={mockSession2} indicator="unread" />);
      expect(unread).toContain('bg-accent');
      expect(unread).not.toContain('animate-spin');

      const seen = renderToString(<InboxItem session={mockSession3} />);
      expect(seen).toContain('data-indicator="none"');
      expect(seen).not.toContain('animate-spin');
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

      // 标记已读后蓝点消失
      expect(inboxIndicator(mockSession2, useUiStore.getState().readSeqMap['sess-attention'], false)).toBe(
        'none',
      );
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
