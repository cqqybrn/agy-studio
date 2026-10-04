import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptStep } from '@agy-studio/contracts';
import type { SubagentItem } from '../../domain/timeline.types';
import {
  clearSubagentTranscriptCache,
  extractTarget,
  formatPromptSummary,
  getSubagentTranscriptFromCache,
  inferToolKind,
  setSubagentTranscriptInCache,
  subagentTranscriptCache,
  SubagentCard,
  SubagentCardContainer,
} from './index';

// ----------------------------------------------------------------------------
// Mock getSubagentTranscript from endpoints
// ----------------------------------------------------------------------------
const mockGetSubagentTranscript = vi.fn();

vi.mock('../../api/endpoints', () => ({
  getSubagentTranscript: (...args: any[]) => mockGetSubagentTranscript(...args),
}));

// Mock useSessionStore to return activeSessionId
vi.mock('../../stores/session.store', () => ({
  useSessionStore: vi.fn((selector?: any) => {
    const state = { activeSessionId: 'mock-session-123' };
    return selector ? selector(state) : state;
  }),
}));

describe('SubagentCard & SubagentCardContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSubagentTranscriptCache();
  });

  const baseItem: SubagentItem = {
    id: 'subagent-1',
    kind: 'subagent',
    type: 'subagent',
    conversationId: 'conv-agent-alpha',
    role: 'Architect',
    typeName: 'generalPurpose',
    initialPrompt: 'Investigate architecture and provide refactoring steps.\nLine 2 details.',
    status: 'completed',
    parentToolCallId: null,
    runId: 'run-1',
    createdAt: '2026-09-28T12:00:00.000Z',
    updatedAt: '2026-09-28T12:02:00.000Z',
    steps: [],
  };

  // ==========================================================================
  // Helper & Pure Logic Unit Tests
  // ==========================================================================
  describe('Utility Functions', () => {
    it('formatPromptSummary extracts first line and truncates correctly', () => {
      expect(formatPromptSummary(null)).toBeNull();
      expect(formatPromptSummary('')).toBeNull();
      expect(formatPromptSummary('Single line prompt')).toBe('Single line prompt');

      const multiline = 'First line to show\nSecond line should be ignored';
      expect(formatPromptSummary(multiline)).toBe('First line to show');

      const longPrompt = 'A'.repeat(100);
      const summary = formatPromptSummary(longPrompt, 30);
      expect(summary).toBe('A'.repeat(30) + '…');
    });

    it('inferToolKind identifies standard and prefix-based tool kinds', () => {
      expect(inferToolKind('run_command')).toBe('run_command');
      expect(inferToolKind('bash')).toBe('run_command');
      expect(inferToolKind('view_file')).toBe('view_file');
      expect(inferToolKind('read_resource')).toBe('view_file');
      expect(inferToolKind('edit_file')).toBe('edit_file');
      expect(inferToolKind('replace_file_content')).toBe('edit_file');
      expect(inferToolKind('write_file')).toBe('write_file');
      expect(inferToolKind('grep_search')).toBe('search');
      expect(inferToolKind('search')).toBe('search');
      expect(inferToolKind('browser_click_element')).toBe('browser');
      expect(inferToolKind('mcp__db__query')).toBe('mcp');
      expect(inferToolKind('custom_unknown_action')).toBe('other');
    });

    it('extractTarget extracts appropriate subject for various tool kinds', () => {
      expect(extractTarget('run_command', { command: 'npm test' })).toBe('npm test');
      expect(extractTarget('view_file', { path: 'src/main.ts' })).toBe('src/main.ts');
      expect(extractTarget('edit_file', { absolute_path: '/repo/src/App.tsx' })).toBe('/repo/src/App.tsx');
      expect(extractTarget('search', { query: 'interface SubagentItem' })).toBe('interface SubagentItem');
      expect(extractTarget('browser', { url: 'https://example.com' })).toBe('https://example.com');
      expect(extractTarget('other', { path: 'foo.txt' })).toBe('foo.txt');
      expect(extractTarget('run_command', undefined)).toBeNull();
    });
  });

  // ==========================================================================
  // SubagentCard Stateless Component Tests
  // ==========================================================================
  describe('SubagentCard (Stateless UI)', () => {
    it('renders role, typeName, StatusDot, and prompt summary in header', () => {
      const html = renderToString(<SubagentCard item={baseItem} />);

      expect(html).toContain('Architect');
      expect(html).toContain('generalPurpose');
      expect(html).toContain('data-testid="subagent-prompt-summary"');
      expect(html).toContain('>Investigate architecture and provide refactoring steps.</div>');
      expect(html).toContain('data-testid="status-dot-completed"');
      expect(html).toContain('aria-expanded="false"');
    });

    it('renders expanded content including ThinkingBlock, ToolCard, and MessageMarkdown', () => {
      const sampleSteps: TranscriptStep[] = [
        {
          stepIndex: 0,
          type: 'thought',
          status: 'ok',
          createdAt: '2026-09-28T12:00:10.000Z',
          content: null,
          thinking: 'Planning the architecture analysis steps...',
          toolCalls: [],
          error: null,
        },
        {
          stepIndex: 1,
          type: 'tool',
          status: 'ok',
          createdAt: '2026-09-28T12:00:20.000Z',
          content: null,
          thinking: null,
          toolCalls: [
            {
              name: 'view_file',
              args: { path: 'frontend/src/domain/timeline.types.ts' },
            },
          ],
          error: null,
        },
        {
          stepIndex: 2,
          type: 'message',
          status: 'ok',
          createdAt: '2026-09-28T12:00:30.000Z',
          content: 'Analysis complete: found all atomic timeline components.',
          thinking: null,
          toolCalls: [],
          error: null,
        },
      ];

      const html = renderToString(
        <SubagentCard item={baseItem} steps={sampleSteps} defaultExpanded={true} />
      );

      expect(html).toContain('aria-expanded="true"');
      expect(html).toContain('data-testid="thinking-block"');
      expect(html).toContain('Thought');
      expect(html).toContain('timeline.types.ts');
      expect(html).toContain('Analysis complete: found all atomic timeline components.');
    });

    it('renders loading placeholder when isLoading is true', () => {
      const html = renderToString(
        <SubagentCard item={baseItem} isExpanded={true} isLoading={true} />
      );

      expect(html).toContain('data-testid="subagent-loading"');
      expect(html).toContain('正在加载子 Agent 步骤...');
    });

    it('renders error message and retry button when error is present', () => {
      const onRetryMock = vi.fn();
      const html = renderToString(
        <SubagentCard
          item={baseItem}
          isExpanded={true}
          error="Failed to fetch transcript (500 Internal Error)"
          onRetry={onRetryMock}
        />
      );

      expect(html).toContain('data-testid="subagent-error"');
      expect(html).toContain('Failed to fetch transcript (500 Internal Error)');
      expect(html).toContain('data-testid="subagent-retry-btn"');
      expect(html).toContain('重试');
    });

    it('renders empty placeholder when steps list is empty', () => {
      const html = renderToString(
        <SubagentCard item={baseItem} steps={[]} isExpanded={true} />
      );

      expect(html).toContain('data-testid="subagent-empty"');
      expect(html).toContain('暂无步骤记录');
    });
  });

  // ==========================================================================
  // Step Truncation & "Load earlier steps" Tests (> 200 steps)
  // ==========================================================================
  describe('Step Truncation (> 200 steps)', () => {
    const generateSteps = (count: number): TranscriptStep[] => {
      return Array.from({ length: count }, (_, i) => ({
        stepIndex: i,
        type: 'step',
        status: 'ok',
        createdAt: '2026-09-28T12:00:00.000Z',
        content: `Content for step index #${i}`,
        thinking: null,
        toolCalls: [],
        error: null,
      }));
    };

    it('truncates to the last 200 steps and displays "Load earlier steps" button when steps > 200', () => {
      const totalSteps = 205;
      const steps = generateSteps(totalSteps);

      const html = renderToString(
        <SubagentCard
          item={{ ...baseItem, steps }}
          defaultExpanded={true}
          showEarlierSteps={false}
        />
      );

      // 顶部应当提供显示更早步骤按钮，并标注隐藏的步数 (205 - 200 = 5)
      expect(html).toContain('data-testid="load-earlier-steps-btn"');
      expect(html).toContain('显示更早的步骤 (Load earlier steps)');
      expect(html).toContain('步隐藏');
      expect(html).toContain('5');

      // 前 5 步（索引 0 到 4）不应出现
      expect(html).not.toContain('data-step-index="0"');
      expect(html).not.toContain('data-step-index="4"');

      // 后 200 步（索引 5 到 204）应当出现
      expect(html).toContain('data-step-index="5"');
      expect(html).toContain('data-step-index="204"');
    });

    it('renders all steps and hides the button when showEarlierSteps is true', () => {
      const totalSteps = 205;
      const steps = generateSteps(totalSteps);

      const html = renderToString(
        <SubagentCard
          item={{ ...baseItem, steps }}
          defaultExpanded={true}
          showEarlierSteps={true}
        />
      );

      // 按钮不再显示
      expect(html).not.toContain('data-testid="load-earlier-steps-btn"');

      // 所有步骤（包括最早的索引 0）均显示
      expect(html).toContain('Content for step index #0');
      expect(html).toContain('Content for step index #204');
    });

    it('does not truncate when step count is exactly 200 or fewer', () => {
      const steps200 = generateSteps(200);

      const html = renderToString(
        <SubagentCard item={{ ...baseItem, steps: steps200 }} defaultExpanded={true} />
      );

      expect(html).not.toContain('data-testid="load-earlier-steps-btn"');
      expect(html).toContain('Content for step index #0');
      expect(html).toContain('Content for step index #199');
    });
  });

  // ==========================================================================
  // SubagentCardContainer & Caching Mechanism Tests
  // ==========================================================================
  describe('SubagentCardContainer', () => {
    it('uses existing steps directly when subagent is still running, without calling getSubagentTranscript', () => {
      const runningSteps: TranscriptStep[] = [
        {
          stepIndex: 0,
          type: 'thought',
          status: 'ok',
          createdAt: '2026-09-28T12:00:00.000Z',
          content: 'Real-time thinking in progress...',
          thinking: null,
          toolCalls: [],
          error: null,
        },
      ];

      const runningItem: SubagentItem = {
        ...baseItem,
        status: 'running',
        steps: runningSteps,
      };

      const html = renderToString(
        <SubagentCardContainer
          item={runningItem}
          sessionId="session-1"
          defaultExpanded={true}
        />
      );

      expect(html).toContain('Real-time thinking in progress...');
      expect(html).toContain('data-testid="status-dot-running"');
      // 运行中不触发 API 请求
      expect(mockGetSubagentTranscript).not.toHaveBeenCalled();
    });

    it('uses existing steps directly when completed subagent already has steps in item', () => {
      const existingSteps: TranscriptStep[] = [
        {
          stepIndex: 0,
          type: 'message',
          status: 'ok',
          createdAt: '2026-09-28T12:00:00.000Z',
          content: 'Already has full steps from initial load',
          thinking: null,
          toolCalls: [],
          error: null,
        },
      ];

      const itemWithSteps: SubagentItem = {
        ...baseItem,
        status: 'completed',
        steps: existingSteps,
      };

      const html = renderToString(
        <SubagentCardContainer
          item={itemWithSteps}
          sessionId="session-1"
          defaultExpanded={true}
        />
      );

      expect(html).toContain('Already has full steps from initial load');
      expect(mockGetSubagentTranscript).not.toHaveBeenCalled();
    });

    it('caches lazy-loaded transcript and calls getSubagentTranscript only once across repeated expands', async () => {
      const lazySteps: TranscriptStep[] = [
        {
          stepIndex: 0,
          type: 'thought',
          status: 'ok',
          createdAt: '2026-09-28T12:00:00.000Z',
          content: 'Lazily loaded message step',
          thinking: null,
          toolCalls: [],
          error: null,
        },
      ];

      mockGetSubagentTranscript.mockResolvedValue({
        steps: lazySteps,
        total: 1,
      });

      const lazyItem: SubagentItem = {
        ...baseItem,
        conversationId: 'conv-lazy-target',
        status: 'completed',
        steps: [], // 本地无完整 steps
      };

      const cacheKey = 'session-1:conv-lazy-target';

      // 验证初始状态：缓存未命中
      expect(subagentTranscriptCache.has(cacheKey)).toBe(false);

      // 模拟首次懒加载获取
      // （测试模块级缓存写入与读取交互）
      const fetched = await mockGetSubagentTranscript('session-1', 'conv-lazy-target');
      setSubagentTranscriptInCache(cacheKey, fetched.steps);

      expect(mockGetSubagentTranscript).toHaveBeenCalledTimes(1);
      expect(subagentTranscriptCache.get(cacheKey)).toEqual(lazySteps);

      // 首次展开渲染（使用已填充缓存）
      const htmlExpanded1 = renderToString(
        <SubagentCardContainer
          item={lazyItem}
          sessionId="session-1"
          defaultExpanded={true}
        />
      );
      expect(htmlExpanded1).toContain('Lazily loaded message step');
      expect(mockGetSubagentTranscript).toHaveBeenCalledTimes(1);

      // 折叠渲染
      const htmlCollapsed = renderToString(
        <SubagentCardContainer
          item={lazyItem}
          sessionId="session-1"
          defaultExpanded={false}
        />
      );
      expect(htmlCollapsed).not.toContain('Lazily loaded message step');
      expect(mockGetSubagentTranscript).toHaveBeenCalledTimes(1);

      // 再次展开渲染（测试反复折叠/展开只请求一次）
      const htmlExpanded2 = renderToString(
        <SubagentCardContainer
          item={lazyItem}
          sessionId="session-1"
          defaultExpanded={true}
        />
      );
      expect(htmlExpanded2).toContain('Lazily loaded message step');
      // 仍然只调用了一次（缓存生效）
      expect(mockGetSubagentTranscript).toHaveBeenCalledTimes(1);
    });

    it('clearSubagentTranscriptCache resets the module-level cache', () => {
      const sampleSteps: TranscriptStep[] = [
        {
          stepIndex: 0,
          type: 'thought',
          status: 'ok',
          createdAt: null,
          content: 'Temp step',
          thinking: null,
          toolCalls: [],
          error: null,
        },
      ];

      setSubagentTranscriptInCache('s1:c1', sampleSteps);
      expect(getSubagentTranscriptFromCache('s1:c1')).toEqual(sampleSteps);

      clearSubagentTranscriptCache();
      expect(getSubagentTranscriptFromCache('s1:c1')).toBeUndefined();
      expect(subagentTranscriptCache.size).toBe(0);
    });
  });
});
