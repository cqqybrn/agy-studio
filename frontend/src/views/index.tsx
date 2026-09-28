import React, { useState } from 'react';
import type { ToolCall, TranscriptStep } from '@agy-studio/contracts';
import {
  AttachmentChip,
  Composer,
  EffortPicker,
  ModelPicker,
  ModePicker,
} from '../components/composer';
import {
  ErrorNotice,
  MessageMarkdown,
  RunDivider,
  StalledNotice,
  StatusDot,
  SubagentCard,
  SubagentCardContainer,
  ThinkingBlock,
  ToolCard,
  ToolGroupCard,
} from '../components/timeline';
import type {
  ErrorItem,
  RunDividerItem,
  StalledNoticeItem,
  SubagentItem,
  ThinkingItem,
  ToolGroupItem,
  ToolItem,
} from '../domain/timeline.types';

export function ManagerView() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center text-text-secondary">
      <div className="max-w-md rounded-xl border border-border-default bg-bg-surface p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-text-primary">会话主视图 (ManagerView)</h2>
        <p className="mt-2 text-sm text-text-secondary">
          时间线、思考块、工具调用卡片与底部输入框骨架
        </p>
        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-text-tertiary font-mono">
          <span>左侧收件箱</span>
          <span>•</span>
          <span>中央对话流</span>
          <span>•</span>
          <span>右侧 Artifacts</span>
        </div>
      </div>
    </div>
  );
}

export function AccountsView() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center text-text-secondary">
      <div className="max-w-md rounded-xl border border-border-default bg-bg-surface p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-text-primary">账号管理 (AccountsView)</h2>
        <p className="mt-2 text-sm text-text-secondary">
          展示隔离模式、账号列表、网页登录与凭据状态
        </p>
      </div>
    </div>
  );
}

export function SettingsView() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center text-text-secondary">
      <div className="max-w-md rounded-xl border border-border-default bg-bg-surface p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-text-primary">全局设置 (SettingsView)</h2>
        <p className="mt-2 text-sm text-text-secondary">
          自动同意规则、运行超时、模型默认参数与偏好配置
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Mock Data for PlaygroundView
// ============================================================================

const mockThinkingCompleted: ThinkingItem = {
  id: 'th-1',
  kind: 'thinking',
  type: 'thinking',
  blockId: 'b-1',
  source: 'stream',
  text: `Thinking Process:
1. Understand user request: Implement timeline atomic components.
2. Check architecture docs §2.11 and timeline.types.ts.
3. Design clean, low-contrast Antigravity dark theme panels.
4. Verify all components are stateless and don't import stores or APIs directly.
5. Provide tests covering expand/collapse, dispatching, and GFM formatting.`,
  startedAt: new Date(Date.now() - 12400).toISOString(),
  endedAt: new Date().toISOString(),
  durationMs: 12400,
  isComplete: true,
  runId: 'run-1',
};

const mockThinkingRunning: ThinkingItem = {
  id: 'th-2',
  kind: 'thinking',
  type: 'thinking',
  blockId: 'b-2',
  source: 'stream',
  text: 'Analyzing AST nodes and calculating additions/deletions diff…',
  startedAt: new Date().toISOString(),
  endedAt: null,
  durationMs: null,
  isComplete: false,
  runId: 'run-1',
};

const mockFileEditTool: ToolItem = {
  id: 'tool-fe-1',
  kind: 'tool',
  type: 'tool',
  toolCallId: 'tc-fe-1',
  tool: {
    toolCallId: 'tc-fe-1',
    name: 'edit_file',
    kind: 'edit_file',
    input: {
      path: 'frontend/src/components/timeline/ToolCard.tsx',
      old_string: '// old dispatch logic',
      new_string: '// new robust dispatcher with fallback support',
    },
    target: 'frontend/src/components/timeline/ToolCard.tsx',
    output: 'Successfully applied replacement in ToolCard.tsx',
    error: null,
    status: 'succeeded',
    fileChanges: [
      {
        path: 'frontend/src/components/timeline/ToolCard.tsx',
        changeType: 'modified',
        additions: 14,
        deletions: 3,
      },
    ],
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  },
  subagents: [],
  runId: 'run-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockFileEditFailed: ToolItem = {
  id: 'tool-fe-2',
  kind: 'tool',
  type: 'tool',
  toolCallId: 'tc-fe-2',
  tool: {
    toolCallId: 'tc-fe-2',
    name: 'edit_file',
    kind: 'edit_file',
    input: {
      path: 'frontend/src/config.ts',
    },
    target: 'frontend/src/config.ts',
    output: null,
    error: 'ENOENT: File not found at target workspace path',
    status: 'failed',
    fileChanges: [],
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  },
  subagents: [],
  runId: 'run-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockCommandTool: ToolItem = {
  id: 'tool-cmd-1',
  kind: 'tool',
  type: 'tool',
  toolCallId: 'tc-cmd-1',
  tool: {
    toolCallId: 'tc-cmd-1',
    name: 'run_command',
    kind: 'run_command',
    input: {
      command: 'npm run test -w frontend',
    },
    target: 'npm run test -w frontend',
    output: `> vitest run
 RUN  v3.2.7 G:/new/frontend
 ✓ src/components/timeline/timeline.test.tsx (14 tests) 15ms
 ✓ src/domain/timelineReducer.test.ts (32 tests) 8ms

 Test Files  2 passed (2)
      Tests  46 passed (46)
   Duration  412ms`,
    error: null,
    status: 'succeeded',
    fileChanges: [],
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  },
  subagents: [],
  runId: 'run-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockCommandFailed: ToolItem = {
  id: 'tool-cmd-2',
  kind: 'tool',
  type: 'tool',
  toolCallId: 'tc-cmd-2',
  tool: {
    toolCallId: 'tc-cmd-2',
    name: 'run_command',
    kind: 'run_command',
    input: {
      command: 'git checkout non-existent-branch',
    },
    target: 'git checkout non-existent-branch',
    output: 'error: pathspec \'non-existent-branch\' did not match any file(s) known to git',
    error: 'Exit code 1',
    status: 'failed',
    fileChanges: [],
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  },
  subagents: [],
  runId: 'run-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const longOutputLines = Array.from({ length: 30 }, (_, i) => `[build] step ${i + 1}/30 completed in ${(Math.random() * 20 + 5).toFixed(1)}ms`);
const mockCommandLong: ToolItem = {
  id: 'tool-cmd-3',
  kind: 'tool',
  type: 'tool',
  toolCallId: 'tc-cmd-3',
  tool: {
    toolCallId: 'tc-cmd-3',
    name: 'run_command',
    kind: 'run_command',
    input: {
      command: 'npm run build',
    },
    target: 'npm run build',
    output: longOutputLines.join('\n'),
    error: null,
    status: 'succeeded',
    fileChanges: [],
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  },
  subagents: [],
  runId: 'run-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockSearchTool: ToolItem = {
  id: 'tool-search-1',
  kind: 'tool',
  type: 'tool',
  toolCallId: 'tc-search-1',
  tool: {
    toolCallId: 'tc-search-1',
    name: 'search',
    kind: 'search',
    input: {
      query: 'TimelineItem',
      path: 'frontend/src/domain',
    },
    target: 'TimelineItem',
    output: `frontend/src/domain/timeline.types.ts:25:export type TimelineItemKind =
frontend/src/domain/timeline.types.ts:167:export type TimelineItem =
frontend/src/domain/timelineReducer.ts:4:import type { TimelineItem }`,
    error: null,
    status: 'succeeded',
    fileChanges: [],
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  },
  subagents: [],
  runId: 'run-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockBrowserTool: ToolItem = {
  id: 'tool-browser-1',
  kind: 'tool',
  type: 'tool',
  toolCallId: 'tc-browser-1',
  tool: {
    toolCallId: 'tc-browser-1',
    name: 'browser_navigate',
    kind: 'browser',
    input: {
      action: 'navigate',
      url: 'http://localhost:5173/playground',
      title: 'AGY Studio Playground',
    },
    target: 'http://localhost:5173/playground',
    output: 'Navigation succeeded (HTTP 200 OK, DOM loaded in 120ms)',
    error: null,
    status: 'succeeded',
    fileChanges: [],
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  },
  subagents: [],
  runId: 'run-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockMcpTool: ToolItem = {
  id: 'tool-mcp-1',
  kind: 'tool',
  type: 'tool',
  toolCallId: 'tc-mcp-1',
  tool: {
    toolCallId: 'tc-mcp-1',
    name: 'mcp__database__query_users',
    kind: 'mcp',
    input: {
      server: 'database',
      limit: 5,
      filter: { active: true },
    },
    target: null,
    output: JSON.stringify(
      [
        { id: 1, name: 'Alice', active: true },
        { id: 2, name: 'Bob', active: true },
      ],
      null,
      2
    ),
    error: null,
    status: 'succeeded',
    fileChanges: [],
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  },
  subagents: [],
  runId: 'run-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockGenericTool: ToolItem = {
  id: 'tool-gen-1',
  kind: 'tool',
  type: 'tool',
  toolCallId: 'tc-gen-1',
  tool: {
    toolCallId: 'tc-gen-1',
    name: 'custom_orchestrator_check',
    kind: 'other',
    input: {
      clusterId: 'prod-east-1',
      threshold: 0.95,
    },
    target: null,
    output: 'All health probes passed successfully.',
    error: null,
    status: 'succeeded',
    fileChanges: [],
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  },
  subagents: [],
  runId: 'run-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockToolGroup: ToolGroupItem = {
  id: 'tg-1',
  kind: 'tool_group',
  type: 'tool_group',
  tools: [
    {
      id: 'tg-sub-1',
      kind: 'tool',
      type: 'tool',
      toolCallId: 'tc-sub-1',
      tool: {
        toolCallId: 'tc-sub-1',
        name: 'view_file',
        kind: 'view_file',
        input: { path: 'frontend/src/theme.css' },
        target: 'frontend/src/theme.css',
        output: '/* 64 lines */',
        error: null,
        status: 'succeeded',
        fileChanges: [],
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
      subagents: [],
      runId: 'run-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'tg-sub-2',
      kind: 'tool',
      type: 'tool',
      toolCallId: 'tc-sub-2',
      tool: {
        toolCallId: 'tc-sub-2',
        name: 'view_file',
        kind: 'view_file',
        input: { path: 'frontend/src/domain/timeline.types.ts' },
        target: 'frontend/src/domain/timeline.types.ts',
        output: '/* 185 lines */',
        error: null,
        status: 'succeeded',
        fileChanges: [],
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
      subagents: [],
      runId: 'run-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'tg-sub-3',
      kind: 'tool',
      type: 'tool',
      toolCallId: 'tc-sub-3',
      tool: {
        toolCallId: 'tc-sub-3',
        name: 'search',
        kind: 'search',
        input: { query: 'StatusDot', path: 'frontend/src' },
        target: 'StatusDot',
        output: 'Found 3 occurrences',
        error: null,
        status: 'succeeded',
        fileChanges: [],
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
      subagents: [],
      runId: 'run-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  runId: 'run-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockRunDividerCompleted: RunDividerItem = {
  id: 'rd-1',
  kind: 'run_divider',
  type: 'run_divider',
  runId: 'run-1',
  status: 'completed',
  durationMs: 14820,
  usage: {
    inputTokens: 2480,
    outputTokens: 620,
    thinkingTokens: 380,
    cacheReadTokens: 1200,
    totalTokens: 3100,
  },
  error: null,
  agyConversationId: 'conv-xyz',
  timestamp: new Date().toISOString(),
};

const mockRunDividerFailed: RunDividerItem = {
  id: 'rd-2',
  kind: 'run_divider',
  type: 'run_divider',
  runId: 'run-2',
  status: 'failed',
  durationMs: 2400,
  usage: null,
  error: {
    code: 'AGY_EXIT',
    message: 'Process exited abnormally with code 137 (OOM)',
    retryable: false,
  },
  agyConversationId: null,
  timestamp: new Date().toISOString(),
};

const mockRunDividerAborted: RunDividerItem = {
  id: 'rd-3',
  kind: 'run_divider',
  type: 'run_divider',
  runId: 'run-3',
  status: 'aborted',
  durationMs: 4500,
  usage: {
    inputTokens: 950,
    outputTokens: 42,
    thinkingTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 992,
  },
  error: null,
  agyConversationId: null,
  timestamp: new Date().toISOString(),
};

const mockErrorItemRetryable: ErrorItem = {
  id: 'err-1',
  kind: 'error',
  type: 'error',
  error: {
    code: 'SESSION_BUSY',
    message: 'Another run is currently active for this session. Please wait or cancel it.',
    retryable: true,
    details: {
      activeRunId: 'run-77a',
      queueWaitEstimateSeconds: 5,
    },
  },
  runId: 'run-1',
  timestamp: new Date().toISOString(),
};

const mockErrorItemFatal: ErrorItem = {
  id: 'err-2',
  kind: 'error',
  type: 'error',
  error: {
    code: 'QUOTA_EXHAUSTED',
    message: 'Weekly quota bucket for Sonnet 3.7 has reached limit (0% remaining).',
    retryable: false,
    details: {
      bucket: 'claude-3-7-sonnet',
      resetTime: '2026-09-29T00:00:00Z',
    },
  },
  runId: 'run-1',
  timestamp: new Date().toISOString(),
};

const mockStalledNotice: StalledNoticeItem = {
  id: 'stall-1',
  kind: 'stalled_notice',
  type: 'stalled_notice',
  idleMs: 45000,
  runId: 'run-1',
  timestamp: new Date().toISOString(),
};

// ----------------------------------------------------------------------------
// Mock Data for SubagentCard & SubagentCardContainer
// ----------------------------------------------------------------------------

const mockSubagentRunning: SubagentItem = {
  id: 'sub-running-1',
  kind: 'subagent',
  type: 'subagent',
  conversationId: 'conv-sub-running-1',
  role: 'Architect',
  typeName: 'generalPurpose',
  initialPrompt: 'Investigate system architecture and optimize bundle size across frontend and backend modules.',
  status: 'running',
  parentToolCallId: null,
  runId: 'run-1',
  createdAt: new Date(Date.now() - 30000).toISOString(),
  updatedAt: new Date().toISOString(),
  steps: [
    {
      stepIndex: 0,
      type: 'thought',
      status: 'ok',
      createdAt: new Date(Date.now() - 25000).toISOString(),
      content: null,
      thinking: 'Analyzing workspace configuration and dependency trees...',
      toolCalls: [],
      error: null,
    },
    {
      stepIndex: 1,
      type: 'tool',
      status: 'running',
      createdAt: new Date(Date.now() - 15000).toISOString(),
      content: null,
      thinking: null,
      toolCalls: [
        {
          name: 'search',
          args: { query: 'export interface SubagentItem', path: 'frontend/src' },
        },
      ],
      error: null,
    },
  ],
};

const mockSubagentCompletedWithSteps: SubagentItem = {
  id: 'sub-comp-1',
  kind: 'subagent',
  type: 'subagent',
  conversationId: 'conv-sub-comp-1',
  role: 'Investigator',
  typeName: 'explore',
  initialPrompt: 'Locate all exported components under frontend/src/components and generate a summary list.',
  status: 'completed',
  parentToolCallId: null,
  runId: 'run-1',
  createdAt: new Date(Date.now() - 120000).toISOString(),
  updatedAt: new Date(Date.now() - 90000).toISOString(),
  steps: [
    {
      stepIndex: 0,
      type: 'thought',
      status: 'ok',
      createdAt: new Date(Date.now() - 118000).toISOString(),
      content: null,
      thinking: 'Searching for index.ts re-exports in frontend/src/components...',
      toolCalls: [],
      error: null,
    },
    {
      stepIndex: 1,
      type: 'tool',
      status: 'ok',
      createdAt: new Date(Date.now() - 110000).toISOString(),
      content: null,
      thinking: null,
      toolCalls: [
        {
          name: 'view_file',
          args: { path: 'frontend/src/components/timeline/index.ts' },
        },
      ],
      error: null,
    },
    {
      stepIndex: 2,
      type: 'message',
      status: 'ok',
      createdAt: new Date(Date.now() - 95000).toISOString(),
      content: 'Found 9 core components exported: `StatusDot`, `ThinkingBlock`, `ToolCard`, `ToolGroupCard`, `SubagentCard`, `SubagentCardContainer`, `RunDivider`, `ErrorNotice`, `StalledNotice`.',
      thinking: null,
      toolCalls: [],
      error: null,
    },
  ],
};

// 超过 200 步的子 Agent (205 steps)，演示截断渲染与“显示更早步骤”交互
const mockSubagentOverflowSteps: SubagentItem = {
  id: 'sub-overflow-1',
  kind: 'subagent',
  type: 'subagent',
  conversationId: 'conv-sub-overflow-1',
  role: 'Batch Refactor',
  typeName: 'coder',
  initialPrompt: 'Batch execute AST transformations across 205 legacy files and format imports.',
  status: 'completed',
  parentToolCallId: null,
  runId: 'run-1',
  createdAt: new Date(Date.now() - 300000).toISOString(),
  updatedAt: new Date(Date.now() - 100000).toISOString(),
  steps: Array.from({ length: 205 }, (_, i) => ({
    stepIndex: i,
    type: i % 2 === 0 ? 'thought' : 'tool',
    status: 'ok',
    createdAt: new Date(Date.now() - (205 - i) * 1000).toISOString(),
    content: i === 204 ? 'Completed all 205 AST transformations successfully.' : null,
    thinking: i % 2 === 0 ? `Step ${i + 1}: Validating AST syntax tree nodes for batch file #${i + 1}` : null,
    toolCalls: i % 2 === 1 ? [{ name: 'edit_file', args: { path: `src/utils/file_${i}.ts` } }] : [],
    error: null,
  })),
};

const mockSubagentLazyLoad: SubagentItem = {
  id: 'sub-lazy-1',
  kind: 'subagent',
  type: 'subagent',
  conversationId: 'conv-sub-lazy-1',
  role: 'Security Reviewer',
  typeName: 'security-review',
  initialPrompt: 'Perform full OWASP dependency check, scan AST for unsafe evals, and audit permissions.',
  status: 'completed',
  parentToolCallId: null,
  runId: 'run-1',
  createdAt: new Date(Date.now() - 600000).toISOString(),
  updatedAt: new Date(Date.now() - 580000).toISOString(),
  steps: [], // 本地无完整 steps，首次展开懒加载
};

const sampleMarkdown = `# 🎯 Timeline Components Showcase

Antigravity 风格现代 Agent IDE 无状态时间线组件已就绪。所有组件均符合规范：**低对比面板**、*细微边框*、~~过时的重样式~~ 以及科技蓝强调色。

### GFM Checklist
- [x] ThinkingBlock 思考块与运行计时
- [x] ToolCard 智能分发到各类专用卡片
- [x] ToolGroupCard 连续操作折叠汇总
- [x] 模块 2.7 子 Agent 卡片集成 (SubagentCard & Container)

### GFM Table Support
| Feature | Kind | Status | Description |
| :--- | :---: | :---: | :--- |
| File Editor | \`edit_file\` | Ready | Additions/deletions diff pill |
| Terminal | \`run_command\` | Ready | Dark monospace output (20 lines default) |
| Search | \`search\` | Ready | Result counter and expandable list |
| Browser | \`browser\` | Ready | Action dispatch & screenshot preview |

### Code Block with Syntax Highlighting & Copy
\`\`\`typescript
import { ToolCard, ThinkingBlock } from './components/timeline';

export function renderTimelineItem(item: TimelineItem) {
  if (item.kind === 'thinking') {
    return <ThinkingBlock item={item} />;
  }
  if (item.kind === 'tool') {
    return <ToolCard item={item} />;
  }
  return null;
}
\`\`\`

> 💡 架构原则：组件保持完全无状态，不直接 import store 或 API，仅依靠 timeline.types.ts 中的领域契约驱动。
`;

// ============================================================================
// PlaygroundView Component
// ============================================================================

export function PlaygroundView() {
  const [hideThinking, setHideThinking] = useState(false);

  return (
    <div className="h-full overflow-y-auto bg-bg-app p-6 font-sans text-text-primary">
      <div className="mx-auto max-w-4xl space-y-8 pb-16">
        {/* Header Header */}
        <div className="rounded-xl border border-dashed border-accent/40 bg-bg-surface p-5 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="rounded bg-accent-subtle px-2 py-0.5 font-mono text-xs font-semibold text-accent">
                DEV ONLY
              </span>
              <h1 className="text-lg font-bold text-text-primary">
                组件游乐场 (PlaygroundView)
              </h1>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer text-text-secondary hover:text-text-primary">
                <input
                  type="checkbox"
                  checked={hideThinking}
                  onChange={(e) => setHideThinking(e.target.checked)}
                  className="rounded border-border-default bg-bg-surface text-accent"
                />
                <span>隐藏思考块 (hidden preference)</span>
              </label>
            </div>
          </div>
          <p className="mt-2 text-xs text-text-secondary">
            展示模块 2.6 的时间线无状态原子组件在运行中、成功、失败等状态下的视觉表现与交互。
          </p>
        </div>

        {/* 1. StatusDot */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-text-secondary uppercase">
            1. StatusDot 状态小圆点
          </h2>
          <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border-default bg-bg-surface/40 p-4 text-xs font-mono">
            <div className="flex items-center gap-2">
              <StatusDot status="running" />
              <span>running (pulse)</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusDot status="succeeded" />
              <span>succeeded / success</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusDot status="failed" />
              <span>failed / error</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusDot status="stalled" />
              <span>stalled / warning</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusDot status="idle" />
              <span>idle / aborted</span>
            </div>
            <div className="flex items-center gap-2 border-l border-border-subtle pl-4">
              <StatusDot status="succeeded" size="sm" />
              <StatusDot status="succeeded" size="md" />
              <StatusDot status="succeeded" size="lg" />
              <span className="text-text-tertiary">sizes: sm / md / lg</span>
            </div>
          </div>
        </section>

        {/* 2. ThinkingBlock */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-text-secondary uppercase">
            2. ThinkingBlock 思考块
          </h2>
          <div className="space-y-2">
            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                完成状态 (Thought for 12s, 默认折叠，点击展开):
              </div>
              <ThinkingBlock item={mockThinkingCompleted} hidden={hideThinking} />
            </div>

            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                运行中未完成状态 (Thinking… 动效):
              </div>
              <ThinkingBlock item={mockThinkingRunning} hidden={hideThinking} />
            </div>
          </div>
        </section>

        {/* 3. ToolCard Dispatcher & Variations */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-text-secondary uppercase">
            3. ToolCard 工具卡片分发
          </h2>

          <div className="space-y-3">
            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                FileEditCard (文件编辑、+14 −3 变更量、点击展开参数与补丁):
              </div>
              <ToolCard item={mockFileEditTool} />
            </div>

            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                FileEditCard (失败错误状态):
              </div>
              <ToolCard item={mockFileEditFailed} />
            </div>

            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                CommandCard (终端指令输出、复制命令、深色等宽):
              </div>
              <ToolCard item={mockCommandTool} />
            </div>

            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                CommandCard (失败高亮、非 0 退出红色边框):
              </div>
              <ToolCard item={mockCommandFailed} />
            </div>

            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                CommandCard (超长 30 行输出，默认截断 20 行支持展开/收起):
              </div>
              <ToolCard item={mockCommandLong} />
            </div>

            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                SearchCard (代码关键词搜索与结果统计):
              </div>
              <ToolCard item={mockSearchTool} />
            </div>

            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                BrowserCard (浏览器自动化动作与预览):
              </div>
              <ToolCard item={mockBrowserTool} />
            </div>

            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                McpCard (MCP 工具调用与 JSON 参数/返回):
              </div>
              <ToolCard item={mockMcpTool} />
            </div>

            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                GenericToolCard (通用兜底工具卡片):
              </div>
              <ToolCard item={mockGenericTool} />
            </div>
          </div>
        </section>

        {/* 4. ToolGroupCard */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-text-secondary uppercase">
            4. ToolGroupCard 连续工具折叠汇总
          </h2>
          <div className="space-y-2">
            <div className="text-[11px] text-text-tertiary">
              折叠状态汇总 (&quot;Viewed 2 files, 1 search&quot;)，点击展开组内全部子卡片:
            </div>
            <ToolGroupCard item={mockToolGroup} />
          </div>
        </section>

        {/* 5. MessageMarkdown */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-text-secondary uppercase">
            5. MessageMarkdown 富文本与代码块
          </h2>
          <div className="rounded-lg border border-border-default bg-bg-surface/30 p-4">
            <MessageMarkdown content={sampleMarkdown} />
          </div>
        </section>

        {/* 6. RunDivider */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-text-secondary uppercase">
            6. RunDivider 运行完成分隔条
          </h2>
          <div className="space-y-1">
            <div className="text-[11px] text-text-tertiary">正常完成 (耗时、输入/输出/思考 token):</div>
            <RunDivider item={mockRunDividerCompleted} />

            <div className="text-[11px] text-text-tertiary">运行失败 (带错误摘要):</div>
            <RunDivider item={mockRunDividerFailed} />

            <div className="text-[11px] text-text-tertiary">用户手动中止 (Aborted):</div>
            <RunDivider item={mockRunDividerAborted} />
          </div>
        </section>

        {/* 7. ErrorNotice */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-text-secondary uppercase">
            7. ErrorNotice 非终止错误警告条
          </h2>
          <div className="space-y-2">
            <div>
              <div className="text-[11px] text-text-tertiary mb-1">可重试警告 (黄色，带技术细节展开):</div>
              <ErrorNotice item={mockErrorItemRetryable} />
            </div>

            <div>
              <div className="text-[11px] text-text-tertiary mb-1">致命错误 (红色警示):</div>
              <ErrorNotice item={mockErrorItemFatal} />
            </div>
          </div>
        </section>

        {/* 8. StalledNotice */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-text-secondary uppercase">
            8. StalledNotice 卡死/等待提示
          </h2>
          <div className="space-y-2">
            <StalledNotice item={mockStalledNotice} />
          </div>
        </section>

        {/* 9. SubagentCard & Container */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-text-secondary uppercase">
            9. SubagentCard & SubagentCardContainer (子 Agent 卡片)
          </h2>
          <div className="space-y-4">
            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                运行中 (实时追加步骤，StatusDot 动态闪烁，直接使用已有 steps):
              </div>
              <SubagentCardContainer item={mockSubagentRunning} defaultExpanded={true} />
            </div>

            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                已完成且已有完整步骤 (展开展示思考、文件查看与 Markdown 输出):
              </div>
              <SubagentCardContainer item={mockSubagentCompletedWithSteps} defaultExpanded={true} />
            </div>

            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                步骤超过 200 步截断展示 (共 205 步，默认渲染最后 200 步，顶部提供 Load earlier steps 展开按钮):
              </div>
              <SubagentCard item={mockSubagentOverflowSteps} defaultExpanded={true} />
            </div>

            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                已结束且无本地步骤 (首次展开懒加载 transcript，模块级内存缓存，折叠/展开只请求一次):
              </div>
              <SubagentCardContainer item={mockSubagentLazyLoad} />
            </div>

            <div>
              <div className="text-[11px] text-text-tertiary mb-1">
                懒加载失败与重试交互示例 (SubagentCard 错误状态与重试按钮):
              </div>
              <SubagentCard
                item={{
                  ...mockSubagentLazyLoad,
                  conversationId: 'conv-err-demo',
                  role: 'Security Scanner (Error State)',
                }}
                isExpanded={true}
                error="网络请求超时 (504 Gateway Timeout)，未能获取步骤"
                onRetry={() => {}}
              />
            </div>
          </div>
        </section>

        {/* 10. Composer & Sub-pickers */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold tracking-wide text-text-secondary uppercase">
            10. Composer & 选择器 (模块 2.8 输入框与附件)
          </h2>

          <div className="space-y-4">
            {/* Pickers showcase */}
            <div className="rounded-lg border border-border-default bg-bg-surface/30 p-4 space-y-3">
              <div className="text-[11px] text-text-tertiary font-medium">独立选择器与附件胶囊组件：</div>
              <div className="flex flex-wrap items-center gap-3">
                <ModelPicker value="claude-3-7-sonnet" onChange={() => {}} />
                <EffortPicker value="high" onChange={() => {}} />
                <ModePicker value="code" onChange={() => {}} />
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <AttachmentChip
                  attachment={{
                    id: 'demo-img',
                    file: new File([''], 'screenshot.png', { type: 'image/png' }),
                    originalName: 'screenshot.png',
                    size: 1024 * 420,
                    mimeType: 'image/png',
                    status: 'uploaded',
                    progress: 100,
                  }}
                  onDelete={() => {}}
                />
                <AttachmentChip
                  attachment={{
                    id: 'demo-uploading',
                    file: new File([''], 'data-table.csv', { type: 'text/csv' }),
                    originalName: 'data-table.csv',
                    size: 1024 * 128,
                    mimeType: 'text/csv',
                    status: 'uploading',
                    progress: 72,
                  }}
                  onDelete={() => {}}
                />
                <AttachmentChip
                  attachment={{
                    id: 'demo-error',
                    file: new File([''], 'huge-archive.zip', { type: 'application/zip' }),
                    originalName: 'huge-archive.zip',
                    size: 1024 * 1024 * 35,
                    mimeType: 'application/zip',
                    status: 'error',
                    progress: 0,
                    error: '文件超出大小限制',
                  }}
                  onDelete={() => {}}
                  onRetry={() => {}}
                />
              </div>
            </div>

            {/* Composer interactive showcase */}
            <div className="rounded-lg border border-border-default bg-bg-surface/30 p-4 space-y-3">
              <div className="text-[11px] text-text-tertiary font-medium">
                Composer 完整输入框（支持自适应高度、Enter 发送、IME 组字保护、拖拽粘贴附件、草稿按 sessionId 存储、运行中变停止按钮）：
              </div>
              <Composer
                sessionId="playground-demo-session"
                placeholder="尝试在此输入文字（支持 Shift+Enter 换行，Enter 发送，拖拽/粘贴附件）…"
                onSend={async (content, options) => {
                  alert(`[Demo onSend 触发]\n内容: ${content}\n附件数: ${options?.attachmentIds?.length ?? 0}\n模型: ${options?.model ?? '默认'}`);
                }}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
