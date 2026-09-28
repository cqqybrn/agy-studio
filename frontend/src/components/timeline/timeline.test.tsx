import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ToolCall } from '@agy-studio/contracts';
import type {
  ErrorItem,
  RunDividerItem,
  StalledNoticeItem,
  ThinkingItem,
  ToolGroupItem,
  ToolItem,
} from '../../domain/timeline.types';
import {
  ErrorNotice,
  formatGroupSummary,
  formatRunDuration,
  formatThinkingDuration,
  HIGHLIGHT_MAX_CHARS,
  HIGHLIGHT_MAX_LINES,
  MessageMarkdown,
  renderInlineMarkdown,
  RunDivider,
  shouldHighlightCode,
  StalledNotice,
  StatusDot,
  ThinkingBlock,
  ToolCard,
  ToolGroupCard,
} from './index';

describe('Timeline Atomic Components', () => {
  // ==========================================================================
  // StatusDot
  // ==========================================================================
  describe('StatusDot', () => {
    it('renders running pulse ping animation for running and starting status', () => {
      const htmlRunning = renderToString(<StatusDot status="running" />);
      expect(htmlRunning).toContain('data-testid="status-dot-running"');
      expect(htmlRunning).toContain('animate-ping');

      const htmlStarting = renderToString(<StatusDot status="starting" />);
      expect(htmlStarting).toContain('data-testid="status-dot-running"');
    });

    it('renders correct dot styles for success, error, stalled, and idle', () => {
      const htmlSuccess = renderToString(<StatusDot status="succeeded" />);
      expect(htmlSuccess).toContain('data-testid="status-dot-succeeded"');
      expect(htmlSuccess).toContain('bg-[#10b981]');

      const htmlFailed = renderToString(<StatusDot status="failed" />);
      expect(htmlFailed).toContain('data-testid="status-dot-failed"');
      expect(htmlFailed).toContain('bg-[#ef4444]');

      const htmlStalled = renderToString(<StatusDot status="stalled" />);
      expect(htmlStalled).toContain('data-testid="status-dot-stalled"');
      expect(htmlStalled).toContain('bg-[#f59e0b]');

      const htmlIdle = renderToString(<StatusDot status="idle" />);
      expect(htmlIdle).toContain('data-testid="status-dot-idle"');
    });

    it('applies size classes appropriately', () => {
      const htmlSm = renderToString(<StatusDot status="succeeded" size="sm" />);
      expect(htmlSm).toContain('h-1.5 w-1.5');

      const htmlLg = renderToString(<StatusDot status="succeeded" size="lg" />);
      expect(htmlLg).toContain('h-2.5 w-2.5');
    });
  });

  // ==========================================================================
  // ThinkingBlock
  // ==========================================================================
  describe('ThinkingBlock', () => {
    const completedItem: ThinkingItem = {
      id: 'th-1',
      kind: 'thinking',
      type: 'thinking',
      blockId: 'b-1',
      source: 'stream',
      text: 'Detailed reasoning step 1 and step 2.',
      startedAt: '2026-09-28T10:00:00.000Z',
      endedAt: '2026-09-28T10:00:12.400Z',
      durationMs: 12400,
      isComplete: true,
      runId: 'run-1',
    };

    const runningItem: ThinkingItem = {
      id: 'th-2',
      kind: 'thinking',
      type: 'thinking',
      blockId: 'b-2',
      source: 'stream',
      text: 'Currently analyzing files...',
      startedAt: '2026-09-28T10:00:00.000Z',
      endedAt: null,
      durationMs: null,
      isComplete: false,
      runId: 'run-1',
    };

    it('formats duration helper correctly', () => {
      expect(formatThinkingDuration(null)).toBeNull();
      expect(formatThinkingDuration(-100)).toBeNull();
      expect(formatThinkingDuration(500)).toBe('1s');
      expect(formatThinkingDuration(12400)).toBe('12s');
      expect(formatThinkingDuration(45000)).toBe('45s');
    });

    it('renders "Thought for Ns" when completed with duration', () => {
      const html = renderToString(<ThinkingBlock item={completedItem} />);
      expect(html).toContain('Thought for 12s');
      expect(html).not.toContain('Detailed reasoning step 1'); // collapsed by default
    });

    it('renders "Thinking…" when running and without duration', () => {
      const html = renderToString(<ThinkingBlock item={runningItem} />);
      expect(html).toContain('Thinking…');
      expect(html).toContain('data-testid="status-dot-running"');
    });

    it('renders expanded content when defaultExpanded is true', () => {
      const html = renderToString(
        <ThinkingBlock item={completedItem} defaultExpanded={true} />
      );
      expect(html).toContain('Detailed reasoning step 1 and step 2.');
      expect(html).toContain('data-testid="thinking-content"');
    });

    it('does not render at all when hidden is true', () => {
      const html = renderToString(
        <ThinkingBlock item={completedItem} hidden={true} />
      );
      expect(html).toBe('');
    });
  });

  // ==========================================================================
  // ToolCard & Specific Cards Dispatching
  // ==========================================================================
  describe('ToolCard Dispatcher', () => {
    it('dispatches edit_file to FileEditCard with additions and deletions', () => {
      const toolCall: ToolCall = {
        toolCallId: 'tc-1',
        name: 'edit_file',
        kind: 'edit_file',
        input: {
          TargetFile: 'src/components/App.tsx',
          patch: '@@ -1,3 +1,4 @@\n+import { New } from "./new";',
        },
        target: 'src/components/App.tsx',
        output: 'Success',
        error: null,
        status: 'succeeded',
        fileChanges: [
          {
            path: 'src/components/App.tsx',
            changeType: 'modified',
            additions: 12,
            deletions: 3,
          },
        ],
        startedAt: '2026-09-28T10:00:00.000Z',
        endedAt: '2026-09-28T10:00:01.000Z',
      };

      const html = renderToString(
        <ToolCard tool={toolCall} defaultExpanded={true} />
      );
      expect(html).toContain('data-testid="file-edit-card"');
      expect(html).toContain('src/components/App.tsx');
      expect(html).toContain('+12');
      expect(html).toContain('−3');
      expect(html).toContain('+import { New }');
    });

    it('dispatches run_command to CommandCard with terminal styling and copy button', () => {
      const toolCall: ToolCall = {
        toolCallId: 'tc-2',
        name: 'run_command',
        kind: 'run_command',
        input: {
          CommandLine: 'npm run test -w frontend',
        },
        target: 'npm run test -w frontend',
        output: 'PASS src/test.ts (2 tests)',
        error: null,
        status: 'succeeded',
        fileChanges: [],
        startedAt: '2026-09-28T10:00:00.000Z',
        endedAt: '2026-09-28T10:00:01.000Z',
      };

      const html = renderToString(<ToolCard tool={toolCall} />);
      expect(html).toContain('data-testid="command-card"');
      expect(html).toContain('npm run test -w frontend');
      expect(html).toContain('PASS src/test.ts');
      expect(html).toContain('title="Copy command"');
    });

    it('shows the tool name, not raw input keys, when the backend found no target', () => {
      const toolCall: ToolCall = {
        toolCallId: 'tc-2-no-target',
        name: 'run_command',
        kind: 'run_command',
        input: { command: 'should-not-be-read' },
        target: null,
        output: null,
        error: null,
        status: 'running',
        fileChanges: [],
        startedAt: '2026-09-28T10:00:00.000Z',
        endedAt: null,
      };

      const html = renderToString(<ToolCard tool={toolCall} />);
      expect(html).toContain('run_command');
      expect(html).not.toContain('should-not-be-read');
    });

    it('highlights command card with red border on failure', () => {
      const toolCall: ToolCall = {
        toolCallId: 'tc-2-fail',
        name: 'run_command',
        kind: 'run_command',
        input: {
          CommandLine: 'npm run build-fail',
        },
        target: 'npm run build-fail',
        output: 'Error: build failed',
        error: 'Exit code 1',
        status: 'failed',
        fileChanges: [],
        startedAt: '2026-09-28T10:00:00.000Z',
        endedAt: '2026-09-28T10:00:01.000Z',
      };

      const html = renderToString(<ToolCard tool={toolCall} />);
      expect(html).toContain('border-red-500/50');
      expect(html).toContain('data-testid="status-dot-failed"');
    });

    it('dispatches search to SearchCard', () => {
      const toolCall: ToolCall = {
        toolCallId: 'tc-3',
        name: 'search',
        kind: 'search',
        input: {
          Query: 'TimelineItem',
          SearchPath: 'frontend/src',
        },
        target: 'TimelineItem',
        output: 'match 1\nmatch 2\nmatch 3',
        error: null,
        status: 'succeeded',
        fileChanges: [],
        startedAt: '2026-09-28T10:00:00.000Z',
        endedAt: '2026-09-28T10:00:01.000Z',
      };

      const html = renderToString(<ToolCard tool={toolCall} />);
      expect(html).toContain('data-testid="search-card"');
      expect(html).toContain('TimelineItem');
      expect(html).toContain('3 results');
    });

    it('dispatches browser to BrowserCard', () => {
      const toolCall: ToolCall = {
        toolCallId: 'tc-4',
        name: 'browser_navigate',
        kind: 'browser',
        input: {
          Url: 'https://github.com',
        },
        target: 'https://github.com',
        output: 'OK',
        error: null,
        status: 'succeeded',
        fileChanges: [],
        startedAt: '2026-09-28T10:00:00.000Z',
        endedAt: '2026-09-28T10:00:01.000Z',
      };

      const html = renderToString(<ToolCard tool={toolCall} />);
      expect(html).toContain('data-testid="browser-card"');
      expect(html).toContain('navigate');
      expect(html).toContain('https://github.com');
    });

    it('dispatches mcp to McpCard', () => {
      const toolCall: ToolCall = {
        toolCallId: 'tc-5',
        name: 'mcp__postgres__select_users',
        kind: 'mcp',
        input: { limit: 10 },
        target: null,
        output: '[]',
        error: null,
        status: 'succeeded',
        fileChanges: [],
        startedAt: '2026-09-28T10:00:00.000Z',
        endedAt: '2026-09-28T10:00:01.000Z',
      };

      const html = renderToString(<ToolCard tool={toolCall} />);
      expect(html).toContain('data-testid="mcp-card"');
      expect(html).toContain('postgres');
      expect(html).toContain('select_users');
    });

    it('dispatches fallback unknown tool to GenericToolCard', () => {
      const toolCall: ToolCall = {
        toolCallId: 'tc-6',
        name: 'unknown_custom_tool',
        kind: 'other',
        input: { customKey: 'val' },
        target: null,
        output: 'done',
        error: null,
        status: 'succeeded',
        fileChanges: [],
        startedAt: '2026-09-28T10:00:00.000Z',
        endedAt: '2026-09-28T10:00:01.000Z',
      };

      const html = renderToString(<ToolCard tool={toolCall} />);
      expect(html).toContain('data-testid="generic-tool-card"');
      expect(html).toContain('unknown_custom_tool');
    });
  });

  // ==========================================================================
  // ToolGroupCard
  // ==========================================================================
  describe('ToolGroupCard', () => {
    it('summarizes multiple view_file and search tools accurately', () => {
      const mockTools: ToolItem[] = [
        {
          id: 't-1',
          kind: 'tool',
          type: 'tool',
          toolCallId: 'tc-g-1',
          tool: {
            toolCallId: 'tc-g-1',
            name: 'view_file',
            kind: 'view_file',
            input: { AbsolutePath: 'a.ts' },
            target: 'a.ts',
            output: '',
            error: null,
            status: 'succeeded',
            fileChanges: [],
            startedAt: '',
            endedAt: null,
          },
          subagents: [],
          runId: 'r-1',
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 't-2',
          kind: 'tool',
          type: 'tool',
          toolCallId: 'tc-g-2',
          tool: {
            toolCallId: 'tc-g-2',
            name: 'view_file',
            kind: 'view_file',
            input: { AbsolutePath: 'b.ts' },
            target: 'b.ts',
            output: '',
            error: null,
            status: 'succeeded',
            fileChanges: [],
            startedAt: '',
            endedAt: null,
          },
          subagents: [],
          runId: 'r-1',
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 't-3',
          kind: 'tool',
          type: 'tool',
          toolCallId: 'tc-g-3',
          tool: {
            toolCallId: 'tc-g-3',
            name: 'search',
            kind: 'search',
            input: { Query: 'test' },
            target: 'test',
            output: '',
            error: null,
            status: 'succeeded',
            fileChanges: [],
            startedAt: '',
            endedAt: null,
          },
          subagents: [],
          runId: 'r-1',
          createdAt: '',
          updatedAt: '',
        },
      ];

      expect(formatGroupSummary(mockTools)).toBe('Viewed 2 files, 1 search');

      const groupItem: ToolGroupItem = {
        id: 'group-1',
        kind: 'tool_group',
        type: 'tool_group',
        tools: mockTools,
        runId: 'r-1',
        createdAt: '',
        updatedAt: '',
      };

      const html = renderToString(
        <ToolGroupCard item={groupItem} defaultExpanded={true} />
      );
      expect(html).toContain('data-testid="tool-group-card"');
      expect(html).toContain('Viewed 2 files, 1 search');
      expect(html).toContain('data-testid="tool-group-contents"');
      expect(html).toContain('a.ts');
      expect(html).toContain('b.ts');
      expect(html).toContain('test');
    });
  });

  // ==========================================================================
  // MessageMarkdown
  // ==========================================================================
  describe('MessageMarkdown', () => {
    it('renders inline bold, italic, strikethrough, inline code, and links', () => {
      const content = 'Text with **bold** and *italic* and ~~strike~~ and `inlineCode` and [link](https://example.com)';
      const html = renderToString(<MessageMarkdown content={content} />);
      expect(html).toContain('bold</strong>');
      expect(html).toContain('italic</em>');
      expect(html).toContain('<del');
      expect(html).toContain('strike</del>');
      expect(html).toContain('inlineCode</code>');
      expect(html).toContain('href="https://example.com"');
    });

    it('renders headings and blockquotes', () => {
      const content = '# Title H1\n## Section H2\n> Quoted advice';
      const html = renderToString(<MessageMarkdown content={content} />);
      expect(html).toContain('Title H1');
      expect(html).toContain('Section H2');
      expect(html).toContain('<blockquote');
      expect(html).toContain('Quoted advice');
    });

    it('renders GFM tables', () => {
      const markdownTable = `
| Header 1 | Header 2 |
| -------- | -------- |
| Value A  | Value B  |
`;
      const html = renderToString(<MessageMarkdown content={markdownTable} />);
      expect(html).toContain('data-testid="markdown-table"');
      expect(html).toContain('Header 1');
      expect(html).toContain('Header 2');
      expect(html).toContain('Value A');
      expect(html).toContain('Value B');
    });

    it('renders code blocks with syntax styling and copy button', () => {
      const codeMarkdown = `
\`\`\`typescript
const greeting: string = "Hello World";
\`\`\`
`;
      const html = renderToString(<MessageMarkdown content={codeMarkdown} />);
      expect(html).toContain('data-testid="code-block"');
      expect(html).toContain('data-language="typescript"');
      expect(html).toContain('data-testid="copy-code-btn"');
      expect(html).toContain('Copy code');
      expect(html).toContain('Hello World');
    });

    it('still renders code blocks as plain text while streaming', () => {
      const codeMarkdown = '```bash\necho streaming\n```';
      const html = renderToString(<MessageMarkdown content={codeMarkdown} streaming />);
      expect(html).toContain('data-testid="code-block"');
      expect(html).toContain('echo streaming');
    });

    it('skips syntax highlighting for oversized code blocks', () => {
      expect(shouldHighlightCode('const a = 1;\n'.repeat(10))).toBe(true);
      expect(shouldHighlightCode('x\n'.repeat(HIGHLIGHT_MAX_LINES))).toBe(false);
      expect(shouldHighlightCode('x'.repeat(HIGHLIGHT_MAX_CHARS + 1))).toBe(false);
    });

    it('renders task lists with checkboxes', () => {
      const listMarkdown = `
- [x] Done task
- [ ] Todo task
`;
      const html = renderToString(<MessageMarkdown content={listMarkdown} />);
      expect(html).toContain('type="checkbox"');
      expect(html).toContain('Done task');
      expect(html).toContain('Todo task');
    });

    it('filters dangerous link protocols and forbids javascript: in href', () => {
      const dangerousMarkdown = '[x](javascript:alert(1)) and [evil](vbscript:msgbox(1)) and [data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)';
      const html = renderToString(<MessageMarkdown content={dangerousMarkdown} />);
      expect(html).not.toContain('href="javascript:');
      expect(html).not.toContain('javascript:alert(1)');
      expect(html).not.toContain('href="vbscript:');
      expect(html).not.toContain('href="data:');
      expect(html).toContain('x');
    });

    it('renders safe links with http, https, and mailto protocols correctly', () => {
      const safeMarkdown = '[Secure](https://example.com) and [Insecure](http://example.org) and [Contact](mailto:dev@example.com)';
      const html = renderToString(<MessageMarkdown content={safeMarkdown} />);
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('href="http://example.org"');
      expect(html).toContain('href="mailto:dev@example.com"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it('renders all markdown heading levels properly', () => {
      const headingsMarkdown = '# Heading 1\n## Heading 2\n### Heading 3\n#### Heading 4\n##### Heading 5\n###### Heading 6';
      const html = renderToString(<MessageMarkdown content={headingsMarkdown} />);
      expect(html).toContain('<h1');
      expect(html).toContain('Heading 1</h1>');
      expect(html).toContain('<h2');
      expect(html).toContain('Heading 2</h2>');
      expect(html).toContain('<h3');
      expect(html).toContain('Heading 3</h3>');
      expect(html).toContain('<h4');
      expect(html).toContain('Heading 4</h4>');
      expect(html).toContain('<h5');
      expect(html).toContain('Heading 5</h5>');
      expect(html).toContain('<h6');
      expect(html).toContain('Heading 6</h6>');
    });
  });

  // ==========================================================================
  // RunDivider
  // ==========================================================================
  describe('RunDivider', () => {
    it('formats durations properly', () => {
      expect(formatRunDuration(450)).toBe('450ms');
      expect(formatRunDuration(14820)).toBe('14.8s');
      expect(formatRunDuration(65000)).toBe('1m 5s');
    });

    it('renders completed status, duration, and token usage', () => {
      const item: RunDividerItem = {
        id: 'rd-1',
        kind: 'run_divider',
        type: 'run_divider',
        runId: 'r-1',
        status: 'completed',
        durationMs: 12000,
        usage: {
          inputTokens: 1500,
          outputTokens: 400,
          thinkingTokens: 120,
          cacheReadTokens: 0,
          totalTokens: 1900,
        },
        error: null,
        agyConversationId: 'c-1',
        timestamp: '2026-09-28T10:00:12.000Z',
      };

      const html = renderToString(<RunDivider item={item} />);
      expect(html).toContain('data-testid="run-divider"');
      expect(html).toContain('Completed');
      expect(html).toContain('12.0s');
      expect(html).toContain('1,500');
      expect(html).toContain('400');
      expect(html).toContain('1,900');
    });

    it('renders failed status with error pill', () => {
      const item: RunDividerItem = {
        id: 'rd-2',
        kind: 'run_divider',
        type: 'run_divider',
        runId: 'r-2',
        status: 'failed',
        durationMs: 2500,
        usage: null,
        error: {
          code: 'AGY_EXIT',
          message: 'Process killed',
          retryable: false,
        },
        agyConversationId: null,
        timestamp: '2026-09-28T10:00:02.500Z',
      };

      const html = renderToString(<RunDivider item={item} />);
      expect(html).toContain('Failed');
      expect(html).toContain('AGY_EXIT: Process killed');
    });
  });

  // ==========================================================================
  // ErrorNotice & StalledNotice
  // ==========================================================================
  describe('ErrorNotice and StalledNotice', () => {
    it('renders ErrorNotice with retryable badge and message', () => {
      const errorItem: ErrorItem = {
        id: 'err-1',
        kind: 'error',
        type: 'error',
        error: {
          code: 'SESSION_BUSY',
          message: 'Another run is active.',
          retryable: true,
          details: { wait: 10 },
        },
        runId: 'r-1',
        timestamp: '2026-09-28T10:00:00.000Z',
      };

      const html = renderToString(<ErrorNotice item={errorItem} />);
      expect(html).toContain('data-testid="error-notice"');
      expect(html).toContain('SESSION_BUSY');
      expect(html).toContain('Another run is active.');
      expect(html).toContain('可重试 / Retryable');
    });

    it('renders StalledNotice with idle duration', () => {
      const stalledItem: StalledNoticeItem = {
        id: 'st-1',
        kind: 'stalled_notice',
        type: 'stalled_notice',
        idleMs: 30000,
        runId: 'r-1',
        timestamp: '2026-09-28T10:00:30.000Z',
      };

      const html = renderToString(<StalledNotice item={stalledItem} />);
      expect(html).toContain('data-testid="stalled-notice"');
      expect(html).toContain('30s');
      expect(html).toContain('Agent 运行已卡滞或处于等待中');
    });
  });
});
