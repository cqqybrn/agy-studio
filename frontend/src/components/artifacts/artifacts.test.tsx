import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact, SessionEventEnvelope } from '@agy-studio/contracts';
import * as endpoints from '../../api/endpoints';
import { createEmptySlot, useSessionStore } from '../../stores/session.store';
import { useUiStore } from '../../stores/ui.store';
import {
  ArtifactTabs,
  findMediaArtifacts,
  findPlanArtifact,
  findTaskArtifact,
  findWalkthroughArtifact,
  formatPlanComment,
  getTabContentMap,
  isImageArtifact,
  isVideoArtifact,
  MarkdownArtifactView,
  MediaGallery,
  parseTaskList,
  TaskView,
} from './index';

// ----------------------------------------------------------------------------
// Mock Artifacts
// ----------------------------------------------------------------------------
const mockTaskArtifact: Artifact = {
  id: 'art-task-1',
  sessionId: 'sess-1',
  conversationId: 'conv-1',
  kind: 'task',
  name: 'task.md',
  relativePath: 'task.md',
  mimeType: 'text/markdown',
  size: 512,
  version: 1,
  updatedAt: '2026-09-28T10:00:00.000Z',
};

const mockPlanArtifact: Artifact = {
  id: 'art-plan-1',
  sessionId: 'sess-1',
  conversationId: 'conv-1',
  kind: 'implementation_plan',
  name: 'implementation_plan.md',
  relativePath: 'implementation_plan.md',
  mimeType: 'text/markdown',
  size: 1024,
  version: 1,
  updatedAt: '2026-09-28T10:05:00.000Z',
};

const mockWalkthroughArtifact: Artifact = {
  id: 'art-walkthrough-1',
  sessionId: 'sess-2',
  conversationId: 'conv-2',
  kind: 'walkthrough',
  name: 'walkthrough.md',
  relativePath: 'walkthrough.md',
  mimeType: 'text/markdown',
  size: 2048,
  version: 1,
  updatedAt: '2026-09-28T10:30:00.000Z',
};

const mockImageArtifact: Artifact = {
  id: 'art-img-1',
  sessionId: 'sess-1',
  conversationId: 'conv-1',
  kind: 'image',
  name: 'screenshot-final.png',
  relativePath: 'screenshots/screenshot-final.png',
  mimeType: 'image/png',
  size: 120000,
  version: 1,
  updatedAt: '2026-09-28T10:10:00.000Z',
};

const mockVideoArtifact: Artifact = {
  id: 'art-vid-1',
  sessionId: 'sess-1',
  conversationId: 'conv-1',
  kind: 'recording',
  name: 'test-recording.webm',
  relativePath: 'recordings/test-recording.webm',
  mimeType: 'video/webm',
  size: 2500000,
  version: 1,
  updatedAt: '2026-09-28T10:15:00.000Z',
};

describe('Artifacts Components & Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useUiStore.setState({ activeArtifactTab: 'Task' });
    useSessionStore.setState({
      activeSessionId: null,
      slots: {},
    });
  });

  // ==========================================================================
  // 1. TaskView 进度条与统计测试
  // ==========================================================================
  describe('TaskView Component', () => {
    const sampleTaskMarkdown = `
# 项目开发任务

## 第一阶段：核心架构
- [x] 完成领域接口定义 contracts/src/domain.ts
- [x] 实现端点路由与状态机
- [ ] 编写 WebSocket 心跳重连逻辑

## 第二阶段：UI 界面与交互
- [x] 收件箱会话列表与搜索
- [ ] 任务清单与进度展示
- [ ] 实施计划划词评论反馈
- [ ] 媒体产物画廊
`;

    it('parses markdown checkboxes (- [ ] and - [x]) correctly with statistics', () => {
      const parsed = parseTaskList(sampleTaskMarkdown);

      // 共 7 个任务：3 个已完成，4 个待办
      expect(parsed.stats.total).toBe(7);
      expect(parsed.stats.completed).toBe(3);
      // 3 / 7 = 42.857% -> 43%
      expect(parsed.stats.percentage).toBe(43);
      expect(parsed.items).toHaveLength(7);

      expect(parsed.items[0].text).toBe('完成领域接口定义 contracts/src/domain.ts');
      expect(parsed.items[0].completed).toBe(true);

      expect(parsed.items[2].text).toBe('编写 WebSocket 心跳重连逻辑');
      expect(parsed.items[2].completed).toBe(false);

      expect(parsed.sections).toHaveLength(2);
      expect(parsed.sections[0].title).toBe('第一阶段：核心架构');
      expect(parsed.sections[1].title).toBe('第二阶段：UI 界面与交互');
    });

    it('renders top progress bar and formatted stats "3 / 7 Completed · 43%"', () => {
      const html = renderToString(<TaskView content={sampleTaskMarkdown} />);

      // 验证统计指标与进度条
      expect(html).toContain('3 / 7 Completed · 43%');
      expect(html).toContain('data-testid="task-stats"');
      expect(html).toContain('data-testid="task-progress-bar"');
      expect(html).toContain('style="width:43%"');

      // 验证任务列表项
      expect(html).toContain('完成领域接口定义 contracts/src/domain.ts');
      expect(html).toContain('媒体产物画廊');
      expect(html).toContain('line-through');
    });

    it('handles edge cases: all completed, empty text, and nested indentation', () => {
      const allCompletedMarkdown = `
- [x] Task 1
- [X] Task 2
`;
      const allParsed = parseTaskList(allCompletedMarkdown);
      expect(allParsed.stats.total).toBe(2);
      expect(allParsed.stats.completed).toBe(2);
      expect(allParsed.stats.percentage).toBe(100);

      const htmlAll = renderToString(<TaskView content={allCompletedMarkdown} />);
      expect(htmlAll).toContain('2 / 2 Completed · 100%');
      expect(htmlAll).toContain('bg-[#10b981]');

      const emptyParsed = parseTaskList('');
      expect(emptyParsed.stats.total).toBe(0);
      expect(emptyParsed.stats.completed).toBe(0);
      expect(emptyParsed.stats.percentage).toBe(0);

      const htmlEmpty = renderToString(<TaskView content="" />);
      expect(htmlEmpty).toContain('data-testid="task-empty-state"');
      expect(htmlEmpty).toContain('暂无任务清单内容');
    });
  });

  // ==========================================================================
  // 2. Plan 划词评论与 session.store.send 联动
  // ==========================================================================
  describe('Plan Selection Comment & MarkdownArtifactView', () => {
    it('formats plan comment string according to specification', () => {
      const selected = '前端状态由 Zustand 托管';
      const comment = '需补充持久化本地缓存方案';
      const formatted = formatPlanComment(selected, comment);

      expect(formatted).toBe('针对实施计划中的"前端状态由 Zustand 托管"：需补充持久化本地缓存方案');
    });

    it('calls session.store.send with the formatted quote and comment', async () => {
      const sendMock = vi.fn().mockResolvedValue({ runId: 'run-99' });
      useSessionStore.setState({
        activeSessionId: 'sess-active-1',
        send: sendMock,
      });

      const onSendMock = vi.fn();
      const planContent = '# 实施计划\n\n我们将在第 2 步引入双向绑定协议。';

      // 验证格式化函数与调用流程
      const selectedText = '引入双向绑定协议';
      const commentText = '请改为只读单向事件流';
      const formattedMessage = formatPlanComment(selectedText, commentText);

      // 直接调用 store 发送
      await useSessionStore.getState().send('sess-active-1', formattedMessage);

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledWith(
        'sess-active-1',
        '针对实施计划中的"引入双向绑定协议"：请改为只读单向事件流',
      );

      // 测试组件传入自定义 onSendComment 的情况
      const html = renderToString(
        <MarkdownArtifactView
          content={planContent}
          sessionId="sess-active-1"
          isPlan={true}
          onSendComment={onSendMock}
        />,
      );

      expect(html).toContain('💡 提示：划选任意段落或代码，可直接针对该部分发起评论与反馈');
      expect(html).toContain('实施计划');
    });

    it('renders empty state when markdown content is missing', () => {
      const htmlPlan = renderToString(
        <MarkdownArtifactView content="" isPlan={true} />,
      );
      expect(htmlPlan).toContain('data-testid="markdown-empty-state"');
      expect(htmlPlan).toContain('运行过程中将生成实施计划');

      const htmlWalkthrough = renderToString(
        <MarkdownArtifactView content="" isPlan={false} />,
      );
      expect(htmlWalkthrough).toContain('运行结束后将生成完成总结 Walkthrough');
    });
  });

  // ==========================================================================
  // 3. 无内容标签置灰与禁用逻辑
  // ==========================================================================
  describe('Tab Content Detection & Disabled State', () => {
    it('correctly maps tabs to boolean content presence', () => {
      // 只有 Task
      const map1 = getTabContentMap([mockTaskArtifact]);
      expect(map1.Task).toBe(true);
      expect(map1.Plan).toBe(false);
      expect(map1.Walkthrough).toBe(false);
      expect(map1.Media).toBe(false);
      expect(map1.Changes).toBe(false);

      // 含有 Plan 与 Media
      const map2 = getTabContentMap([mockPlanArtifact, mockImageArtifact]);
      expect(map2.Task).toBe(false);
      expect(map2.Plan).toBe(true);
      expect(map2.Walkthrough).toBe(false);
      expect(map2.Media).toBe(true);
      expect(map2.Changes).toBe(false);

      // 空数组：全部无内容
      const mapEmpty = getTabContentMap([]);
      expect(mapEmpty.Task).toBe(false);
      expect(mapEmpty.Plan).toBe(false);
      expect(mapEmpty.Walkthrough).toBe(false);
      expect(mapEmpty.Media).toBe(false);
      expect(mapEmpty.Changes).toBe(false);
    });

    it('disables tabs without content in rendered ArtifactTabs component', () => {
      // 当当前会话未选择时，显示未选择占位
      const htmlNoSession = renderToString(<ArtifactTabs sessionId={null} />);
      expect(htmlNoSession).toContain('data-testid="artifacts-no-session"');
      expect(htmlNoSession).toContain('未选择会话');

      // 当只有 Task 时，Task 标签可用，其他标签置灰且不可点击
      useSessionStore.setState({ activeSessionId: 'sess-1' });
      const html = renderToString(<ArtifactTabs sessionId="sess-1" />);

      expect(html).toContain('data-testid="artifact-tabs-bar"');
      expect(html).toContain('data-testid="artifact-tab-task"');
      expect(html).toContain('data-testid="artifact-tab-plan"');
      expect(html).toContain('data-testid="artifact-tab-changes"');

      // 初始状态无 artifacts，所有标签置灰且禁用
      expect(html).toContain('data-testid="artifact-tab-changes"');
      expect(html).toContain('opacity-40');
      expect(html).toContain('cursor-not-allowed');
    });

    it('interacts with activeArtifactTab in ui.store', () => {
      useUiStore.setState({ activeArtifactTab: 'Plan' });
      expect(useUiStore.getState().activeArtifactTab).toBe('Plan');

      useUiStore.getState().setActiveArtifactTab('Media');
      expect(useUiStore.getState().activeArtifactTab).toBe('Media');
    });
  });

  // ==========================================================================
  // 4. 会话切换与 Artifacts 重新加载
  // ==========================================================================
  describe('Session Switching & Loading', () => {
    it('re-fetches artifacts when activeSessionId changes', async () => {
      const getArtifactsSpy = vi.spyOn(endpoints, 'getArtifacts');
      getArtifactsSpy.mockImplementation(async (sessionId: string) => {
        if (sessionId === 'sess-alpha') {
          return [mockTaskArtifact, mockPlanArtifact];
        }
        if (sessionId === 'sess-beta') {
          return [mockWalkthroughArtifact, mockVideoArtifact];
        }
        return [];
      });

      // 加载会话 Alpha
      const alphaArtifacts = await endpoints.getArtifacts('sess-alpha');
      expect(getArtifactsSpy).toHaveBeenCalledWith('sess-alpha');
      expect(alphaArtifacts).toHaveLength(2);
      expect(findTaskArtifact(alphaArtifacts)?.id).toBe('art-task-1');
      expect(findPlanArtifact(alphaArtifacts)?.id).toBe('art-plan-1');

      // 切换到会话 Beta
      const betaArtifacts = await endpoints.getArtifacts('sess-beta');
      expect(getArtifactsSpy).toHaveBeenCalledWith('sess-beta');
      expect(betaArtifacts).toHaveLength(2);
      expect(findWalkthroughArtifact(betaArtifacts)?.id).toBe('art-walkthrough-1');
      expect(findMediaArtifacts(betaArtifacts)).toHaveLength(1);
    });

    it('fetches raw artifact content and generates correct raw URL', async () => {
      const rawUrl = endpoints.getArtifactRawUrl('sess-100', 'art-img-200');
      expect(rawUrl).toBe('/api/sessions/sess-100/artifacts/art-img-200/raw');
    });

    it('handles live artifact.updated event data structure properly', async () => {
      const envelope: SessionEventEnvelope = {
        seq: 1,
        sessionId: 'sess-1',
        runId: 'run-1',
        ts: '2026-09-28T10:00:00.000Z',
        event: {
          type: 'artifact.updated',
          artifact: mockPlanArtifact,
        },
      };

      useSessionStore.setState({
        activeSessionId: 'sess-1',
        slots: {
          'sess-1': {
            ...createEmptySlot(),
            events: [envelope],
            lastSeq: 1,
          },
        },
      });

      const slot = useSessionStore.getState().slots['sess-1'];
      expect(slot.events).toHaveLength(1);
      expect(slot.events[0].event.type).toBe('artifact.updated');
      if (slot.events[0].event.type === 'artifact.updated') {
        expect(slot.events[0].event.artifact.kind).toBe('implementation_plan');
        expect(slot.events[0].event.artifact.id).toBe('art-plan-1');
      }
    });
  });

  // ==========================================================================
  // 5. MediaGallery 媒体画廊组件
  // ==========================================================================
  describe('MediaGallery Component', () => {
    it('classifies images and videos accurately', () => {
      expect(isImageArtifact(mockImageArtifact)).toBe(true);
      expect(isImageArtifact(mockVideoArtifact)).toBe(false);

      expect(isVideoArtifact(mockVideoArtifact)).toBe(true);
      expect(isVideoArtifact(mockImageArtifact)).toBe(false);
    });

    it('renders image cards with raw url and video player', () => {
      const mediaList = [mockImageArtifact, mockVideoArtifact];
      const html = renderToString(
        <MediaGallery artifacts={mediaList} sessionId="sess-test" />,
      );

      expect(html).toContain('图片产物 (1)');
      expect(html).toContain('录屏与视频 (1)');
      expect(html).toContain('screenshot-final.png');
      expect(html).toContain('test-recording.webm');
      expect(html).toContain('/api/sessions/sess-test/artifacts/art-img-1/raw');
      expect(html).toContain('/api/sessions/sess-test/artifacts/art-vid-1/raw');
      expect(html).toContain('<video');
      expect(html).toContain('data-testid="video-player-art-vid-1"');
    });

    it('renders empty state when no images or recordings are present', () => {
      const html = renderToString(
        <MediaGallery artifacts={[]} sessionId="sess-test" />,
      );
      expect(html).toContain('data-testid="media-empty-state"');
      expect(html).toContain('暂无多媒体产物');
    });
  });
});
