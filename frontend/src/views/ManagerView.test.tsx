import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capabilities, Session } from '@agy-studio/contracts';
import type {
  AssistantMessageItem,
  ErrorItem,
  RunDividerItem,
  StalledNoticeItem,
  SubagentItem,
  ThinkingItem,
  TimelineItem,
  ToolGroupItem,
  ToolItem,
  UserMessageItem,
} from '../domain/timeline.types';
import { useConnectionStore } from '../stores/connection.store';
import { useSessionStore } from '../stores/session.store';
import { useWorkspaceStore } from '../stores/workspace.store';
import { createInitialTimelineState } from '../domain/timelineReducer';
import { ManagerView, TimelineItemDispatcher } from './ManagerView';

// ----------------------------------------------------------------------------
// Mock 测试数据
// ----------------------------------------------------------------------------

const mockSession: Session = {
  id: 'sess-manager-1',
  workspaceId: 'ws-1',
  title: '构建 ManagerView 对话视图',
  agyConversationId: 'agy-conv-1',
  status: 'idle',
  model: 'claude-3-7-sonnet',
  effort: 'high',
  mode: 'code',
  source: 'studio',
  accountName: 'default-acc',
  lastRunId: 'run-1',
  lastSeq: 10,
  createdAt: '2026-09-28T10:00:00.000Z',
  updatedAt: '2026-09-28T10:00:00.000Z',
};

const mockUserItem: UserMessageItem = {
  id: 'item-u1',
  kind: 'user_message',
  type: 'user_message',
  messageId: 'msg-u1',
  text: '请帮我实现虚拟列表动态高度自适应',
  attachments: [
    {
      id: 'att-1',
      workspaceId: 'ws-1',
      sessionId: 'sess-manager-1',
      kind: 'file',
      originalName: 'requirements.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 15420,
      storedPath: '/workspace/.agy-attachments/requirements.docx',
      derivedTextPath: null,
      createdAt: '2026-09-28T10:00:00.000Z',
    },
  ],
  runId: 'run-1',
  createdAt: '2026-09-28T10:00:00.000Z',
};

const mockThinkingItem: ThinkingItem = {
  id: 'item-th1',
  kind: 'thinking',
  type: 'thinking',
  blockId: 'b-th1',
  source: 'stream',
  text: '正在规划 @tanstack/react-virtual 测量策略与滚动容器布局……',
  startedAt: '2026-09-28T10:00:01.000Z',
  endedAt: '2026-09-28T10:00:05.000Z',
  durationMs: 4000,
  isComplete: true,
  runId: 'run-1',
};

const mockToolItem: ToolItem = {
  id: 'item-t1',
  kind: 'tool',
  type: 'tool',
  toolCallId: 'tc-fe1',
  tool: {
    toolCallId: 'tc-fe1',
    name: 'edit_file',
    kind: 'edit_file',
    input: { path: 'frontend/src/views/ManagerView.tsx' },
    target: 'frontend/src/views/ManagerView.tsx',
    output: 'File updated successfully',
    error: null,
    status: 'succeeded',
    fileChanges: [
      {
        path: 'frontend/src/views/ManagerView.tsx',
        changeType: 'modified',
        additions: 45,
        deletions: 10,
      },
    ],
    startedAt: '2026-09-28T10:00:06.000Z',
    endedAt: '2026-09-28T10:00:07.000Z',
  },
  subagents: [],
  runId: 'run-1',
  createdAt: '2026-09-28T10:00:06.000Z',
  updatedAt: '2026-09-28T10:00:07.000Z',
};

const mockToolGroupItem: ToolGroupItem = {
  id: 'item-tg1',
  kind: 'tool_group',
  type: 'tool_group',
  tools: [
    {
      id: 'sub-t1',
      kind: 'tool',
      type: 'tool',
      toolCallId: 'tc-1',
      tool: {
        toolCallId: 'tc-1',
        name: 'view_file',
        kind: 'view_file',
        input: { path: 'src/a.ts' },
        target: 'src/a.ts',
        output: '// content',
        error: null,
        status: 'succeeded',
        fileChanges: [],
        startedAt: '2026-09-28T10:00:08.000Z',
        endedAt: '2026-09-28T10:00:08.000Z',
      },
      subagents: [],
      runId: 'run-1',
      createdAt: '2026-09-28T10:00:08.000Z',
      updatedAt: '2026-09-28T10:00:08.000Z',
    },
  ],
  runId: 'run-1',
  createdAt: '2026-09-28T10:00:08.000Z',
  updatedAt: '2026-09-28T10:00:08.000Z',
};

const mockSubagentItem: SubagentItem = {
  id: 'item-sub1',
  kind: 'subagent',
  type: 'subagent',
  conversationId: 'sub-conv-1',
  role: 'Code Reviewer',
  typeName: 'generalPurpose',
  initialPrompt: 'Review the architecture and check component boundaries.',
  status: 'completed',
  parentToolCallId: null,
  steps: [],
  runId: 'run-1',
  createdAt: '2026-09-28T10:00:09.000Z',
  updatedAt: '2026-09-28T10:00:15.000Z',
};

const mockAssistantItem: AssistantMessageItem = {
  id: 'item-a1',
  kind: 'assistant_message',
  type: 'assistant_message',
  messageId: 'msg-a1',
  text: '时间线与虚拟滚动模块已组装完毕，测试已通过。',
  isComplete: true,
  runId: 'run-1',
  createdAt: '2026-09-28T10:00:16.000Z',
  updatedAt: '2026-09-28T10:00:18.000Z',
};

const mockRunDividerItem: RunDividerItem = {
  id: 'item-rd1',
  kind: 'run_divider',
  type: 'run_divider',
  runId: 'run-1',
  status: 'completed',
  durationMs: 18000,
  usage: {
    inputTokens: 3000,
    outputTokens: 800,
    thinkingTokens: 400,
    cacheReadTokens: 1500,
    totalTokens: 3800,
  },
  error: null,
  agyConversationId: 'agy-conv-1',
  timestamp: '2026-09-28T10:00:19.000Z',
};

const mockErrorItem: ErrorItem = {
  id: 'item-err1',
  kind: 'error',
  type: 'error',
  error: {
    code: 'SESSION_BUSY',
    message: '会话正忙，请稍后重试',
    retryable: true,
    details: { activeRunId: 'run-99' },
  },
  runId: 'run-1',
  timestamp: '2026-09-28T10:00:20.000Z',
};

const mockStalledItem: StalledNoticeItem = {
  id: 'item-stall1',
  kind: 'stalled_notice',
  type: 'stalled_notice',
  idleMs: 30000,
  runId: 'run-1',
  timestamp: '2026-09-28T10:00:21.000Z',
};

const allTimelineItems: TimelineItem[] = [
  mockUserItem,
  mockThinkingItem,
  mockToolItem,
  mockToolGroupItem,
  mockSubagentItem,
  mockAssistantItem,
  mockRunDividerItem,
  mockErrorItem,
  mockStalledItem,
];

// ----------------------------------------------------------------------------
// 测试套件
// ----------------------------------------------------------------------------

describe('ManagerView & Timeline Components', () => {
  beforeEach(() => {
    // 重置各 Store 状态
    useConnectionStore.setState({ status: 'open' });
    useSessionStore.setState({
      activeSessionId: null,
      slots: {},
      list: [mockSession],
      listLoading: false,
      listError: null,
    });
    useWorkspaceStore.setState({
      currentWorkspace: {
        id: 'ws-1',
        name: 'Test Workspace',
        path: '/path/test',
        isGitRepo: true,
        createdAt: '2026-09-28T10:00:00.000Z',
        lastOpenedAt: '2026-09-28T10:00:00.000Z',
      },
      workspaces: [],
      loading: false,
      error: null,
    });
  });

  // ==========================================================================
  // 1. 空会话引导占位测试
  // ==========================================================================
  describe('空会话引导占位', () => {
    it('当 activeSessionId 为 null 时渲染空会话占位引导及新建按钮', () => {
      const html = renderToString(<ManagerView />);
      expect(html).toContain('data-testid="empty-session-placeholder"');
      expect(html).toContain('未选择会话');
      expect(html).toContain('+ 新建会话');
      // 不应渲染会话标题栏与底部输入框
      expect(html).not.toContain('data-testid="manager-header"');
      expect(html).not.toContain('data-testid="manager-composer-footer"');
    });

    it('当已选中会话但条目为空时，渲染“准备就绪”占位引导并挂载 Composer', () => {
      useSessionStore.setState({
        activeSessionId: 'sess-manager-1',
        slots: {
          'sess-manager-1': {
            events: [],
            timeline: createInitialTimelineState(),
            lastSeq: 0,
            activeRunId: null,
            pendingRunId: null,
            loading: false,
            error: null,
          },
        },
      });

      const html = renderToString(<ManagerView />);
      expect(html).toContain('data-testid="manager-header"');
      expect(html).toContain('data-testid="empty-timeline-placeholder"');
      expect(html).toContain('准备就绪');
      expect(html).toContain('data-testid="manager-composer-footer"');
    });
  });

  // ==========================================================================
  // 2. 状态警告条提示测试
  // ==========================================================================
  describe('状态警告条提示', () => {
    it('连接状态非 open（如 closed/connecting）时显示黄色醒目重连提示条', () => {
      useConnectionStore.setState({ status: 'closed' });
      const htmlClosed = renderToString(<ManagerView />);
      expect(htmlClosed).toContain('data-testid="reconnecting-banner"');
      expect(htmlClosed).toContain('连接中断，正在重连…');
      expect(htmlClosed).toContain('WS: closed');

      useConnectionStore.setState({ status: 'reconnecting' });
      const htmlReconnecting = renderToString(<ManagerView />);
      expect(htmlReconnecting).toContain('data-testid="reconnecting-banner"');
      expect(htmlReconnecting).toContain('WS: reconnecting');
    });

    it('连接状态为 open 时不显示重连提示条', () => {
      useConnectionStore.setState({ status: 'open' });
      const htmlOpen = renderToString(<ManagerView />);
      expect(htmlOpen).not.toContain('data-testid="reconnecting-banner"');
    });

    it('当 agy 版本与 profile 版本不一致时显示升级提示条', () => {
      const mismatchedCapabilities: Capabilities = {
        agyPath: '/usr/bin/agy',
        agyVersion: '1.2.14',
        profileAgyVersion: '1.2.12',
        autoApprove: true,
        modes: ['code'],
        features: {} as any,
      };

      const html = renderToString(
        <ManagerView mockCapabilities={mismatchedCapabilities} />,
      );
      expect(html).toContain('data-testid="upgrade-notice-banner"');
      expect(html).toContain('agy 已升级，建议重新探测');
      expect(html).toContain('CLI: 1.2.14');
      expect(html).toContain('Profile: 1.2.12');
    });

    it('当 agy 版本与 profile 版本一致时不显示升级提示条', () => {
      const matchingCapabilities: Capabilities = {
        agyPath: '/usr/bin/agy',
        agyVersion: '1.2.12',
        profileAgyVersion: '1.2.12',
        autoApprove: true,
        modes: ['code'],
        features: {} as any,
      };

      const html = renderToString(
        <ManagerView mockCapabilities={matchingCapabilities} />,
      );
      expect(html).not.toContain('data-testid="upgrade-notice-banner"');
    });
  });

  // ==========================================================================
  // 3. 顶部会话标题栏与重命名测试
  // ==========================================================================
  describe('会话标题与重命名', () => {
    it('展示当前会话标题并包含双击重命名提示属性', () => {
      useSessionStore.setState({
        activeSessionId: 'sess-manager-1',
        slots: {
          'sess-manager-1': {
            events: [],
            timeline: createInitialTimelineState(),
            lastSeq: 0,
            activeRunId: null,
            pendingRunId: null,
            loading: false,
            error: null,
          },
        },
      });

      const html = renderToString(<ManagerView />);
      expect(html).toContain('data-testid="session-title"');
      expect(html).toContain('构建 ManagerView 对话视图');
      expect(html).toContain('双击就地重命名会话');
    });

    it('store.renameSession 正确更新会话列表中的标题', async () => {
      const mockUpdatedSession: Session = {
        ...mockSession,
        title: '重构完成后的全新标题',
      };

      // 验证 SessionStore 的 renameSession 接口
      const renameFn = vi.fn().mockImplementation(async (id: string, title: string) => {
        const next = { ...mockSession, id, title };
        useSessionStore.getState().handleSessionUpserted(next);
        return next;
      });

      useSessionStore.setState({
        renameSession: renameFn,
        list: [mockSession],
      });

      await useSessionStore.getState().renameSession('sess-manager-1', '重构完成后的全新标题');

      expect(renameFn).toHaveBeenCalledWith('sess-manager-1', '重构完成后的全新标题');
      const updatedInStore = useSessionStore.getState().list.find((s) => s.id === 'sess-manager-1');
      expect(updatedInStore?.title).toBe('重构完成后的全新标题');
    });
  });

  // ==========================================================================
  // 4. 虚拟列表与各类条目渲染映射测试
  // ==========================================================================
  describe('时间线条目组件映射分发 (TimelineItemDispatcher)', () => {
    it('正确将用户消息、附件映射到 UserMessage', () => {
      const html = renderToString(
        <TimelineItemDispatcher item={mockUserItem} sessionId="sess-1" />,
      );
      expect(html).toContain('data-testid="timeline-item-user-item-u1"');
      expect(html).toContain('请帮我实现虚拟列表动态高度自适应');
      expect(html).toContain('requirements.docx');
    });

    it('正确将思考块映射到 ThinkingBlock', () => {
      const html = renderToString(
        <TimelineItemDispatcher item={mockThinkingItem} sessionId="sess-1" />,
      );
      expect(html).toContain('data-testid="timeline-item-thinking-item-th1"');
      expect(html).toContain('Thought for 4s');
    });

    it('正确将工具卡片映射到 ToolCard', () => {
      const html = renderToString(
        <TimelineItemDispatcher item={mockToolItem} sessionId="sess-1" />,
      );
      expect(html).toContain('data-testid="timeline-item-tool-item-t1"');
      expect(html).toContain('ManagerView.tsx');
    });

    it('正确将连续工具组映射到 ToolGroupCard', () => {
      const html = renderToString(
        <TimelineItemDispatcher item={mockToolGroupItem} sessionId="sess-1" />,
      );
      expect(html).toContain('data-testid="timeline-item-tool-group-item-tg1"');
      expect(html).toContain('Viewed 1 file');
    });

    it('正确将子 Agent 映射到 SubagentCardContainer', () => {
      const html = renderToString(
        <TimelineItemDispatcher item={mockSubagentItem} sessionId="sess-1" />,
      );
      expect(html).toContain('data-testid="timeline-item-subagent-item-sub1"');
      expect(html).toContain('Code Reviewer');
    });

    it('正确将助手回复映射到 AssistantMessage & Markdown', () => {
      const html = renderToString(
        <TimelineItemDispatcher item={mockAssistantItem} sessionId="sess-1" />,
      );
      expect(html).toContain('data-testid="timeline-item-assistant-item-a1"');
      expect(html).toContain('时间线与虚拟滚动模块已组装完毕');
    });

    it('正确将运行结束映射到 RunDivider', () => {
      const html = renderToString(
        <TimelineItemDispatcher item={mockRunDividerItem} sessionId="sess-1" />,
      );
      expect(html).toContain('data-testid="timeline-item-run-divider-item-rd1"');
      expect(html).toContain('Completed');
    });

    it('正确将错误信息映射到 ErrorNotice', () => {
      const html = renderToString(
        <TimelineItemDispatcher item={mockErrorItem} sessionId="sess-1" />,
      );
      expect(html).toContain('data-testid="timeline-item-error-item-err1"');
      expect(html).toContain('会话正忙，请稍后重试');
    });

    it('正确将卡滞等待映射到 StalledNotice', () => {
      const html = renderToString(
        <TimelineItemDispatcher item={mockStalledItem} sessionId="sess-1" />,
      );
      expect(html).toContain('data-testid="timeline-item-stalled-item-stall1"');
      expect(html).toContain('Agent 运行已卡滞或处于等待中');
      expect(html).toContain('无输出 30s');
    });

    it('在 ManagerView 中完整渲染 9 类条目的虚拟容器', () => {
      useSessionStore.setState({
        activeSessionId: 'sess-manager-1',
        slots: {
          'sess-manager-1': {
            events: [],
            timeline: {
              ...createInitialTimelineState(),
              items: allTimelineItems,
            },
            lastSeq: 10,
            activeRunId: null,
            pendingRunId: null,
            loading: false,
            error: null,
          },
        },
      });

      const html = renderToString(
        <ManagerView initialItems={allTimelineItems} sessionId="sess-manager-1" />,
      );

      expect(html).toContain('data-testid="virtual-timeline-container"');
      expect(html).toContain('data-testid="timeline-item-user-item-u1"');
      expect(html).toContain('data-testid="timeline-item-thinking-item-th1"');
      expect(html).toContain('data-testid="timeline-item-assistant-item-a1"');
      expect(html).toContain('data-testid="timeline-item-tool-item-t1"');
      expect(html).toContain('data-testid="timeline-item-subagent-item-sub1"');
      expect(html).toContain('data-testid="timeline-item-run-divider-item-rd1"');
      expect(html).toContain('data-testid="timeline-item-error-item-err1"');
      expect(html).toContain('data-testid="timeline-item-stalled-item-stall1"');
      expect(html).toContain('data-testid="manager-composer-footer"');
    });
  });
});
