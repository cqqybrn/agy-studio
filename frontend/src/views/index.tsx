import React, { useState } from 'react';
import type { Account, QuotaSnapshot, ToolCall, TranscriptStep, WhoAmI } from '@agy-studio/contracts';
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
import { QuotaPanel, QuotaRing } from '../components/quota';
import { AccountMenu } from '../components/account';
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
} from '../domain/timeline.types';

export { AccountsView } from './AccountsView';
export { ManagerView } from './ManagerView';
import { ManagerView as EmbeddedManagerView } from './ManagerView';

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
// Mock Data for Quota & Account Showcase
// ============================================================================

const mockQuotaSufficient: QuotaSnapshot = {
  source: 'quota_api',
  accountName: 'work-pro',
  email: 'developer@antigravity.corp',
  planTier: 'pro',
  title: 'Claude 3.7 Sonnet 额度 (充足)',
  description: '工作区主账号额度，包含常规会话与大上下文配额',
  groups: [
    {
      displayName: '核心模型限额',
      description: '基于时间滑动窗口计费',
      buckets: [
        {
          bucketId: 'b-5h',
          displayName: '5小时请求窗口',
          window: '5h',
          remainingFraction: 0.85,
          resetTime: new Date(Date.now() + 8100 * 1000).toISOString(),
          resetInSeconds: 8100, // 2 小时 15 分
          description: '5小时内最多允许的请求配额',
          disabled: false,
        },
        {
          bucketId: 'b-weekly',
          displayName: '每周请求额度',
          window: 'weekly',
          remainingFraction: 0.92,
          resetTime: new Date(Date.now() + 345600 * 1000).toISOString(),
          resetInSeconds: 345600, // 4 天
          description: '每周自然周重置',
          disabled: false,
        },
      ],
    },
    {
      displayName: '实验性扩展功能',
      description: '实验室功能',
      buckets: [
        {
          bucketId: 'b-disabled',
          displayName: '高精度代码解释器',
          window: '5h',
          remainingFraction: 0.0,
          resetTime: null,
          resetInSeconds: null,
          description: '当前套餐未激活',
          disabled: true,
        },
      ],
    },
  ],
  credits: { available: true, balance: 3500 },
  fetchedAt: new Date().toISOString(),
  cached: true,
  stale: false,
};

const mockQuotaTight: QuotaSnapshot = {
  source: 'quota_api',
  accountName: 'personal-std',
  email: 'user@example.com',
  planTier: 'standard',
  title: '标准套餐额度 (紧张状态)',
  description: '剩余额度在 20%~50% 之间，指示条显示黄色',
  groups: [
    {
      displayName: '标准请求限额',
      description: null,
      buckets: [
        {
          bucketId: 'b-5h-tight',
          displayName: '5小时请求窗口',
          window: '5h',
          remainingFraction: 0.35,
          resetTime: new Date(Date.now() + 2700 * 1000).toISOString(),
          resetInSeconds: 2700, // 45 分钟
          description: null,
          disabled: false,
        },
      ],
    },
  ],
  credits: { available: false, balance: null },
  fetchedAt: new Date(Date.now() - 30000).toISOString(),
  cached: true,
  stale: false,
};

const mockQuotaCritical: QuotaSnapshot = {
  source: 'quota_api',
  accountName: 'free-tier',
  email: 'tester@preview.com',
  planTier: 'free',
  title: '免费套餐额度 (告警临界)',
  description: '剩余额度低于 20%，指示条显示醒目红色',
  groups: [
    {
      displayName: '免费额度',
      description: null,
      buckets: [
        {
          bucketId: 'b-free-crit',
          displayName: '会话令牌池',
          window: '5h',
          remainingFraction: 0.12,
          resetTime: new Date(Date.now() + 600 * 1000).toISOString(),
          resetInSeconds: 600, // 10 分钟
          description: null,
          disabled: false,
        },
      ],
    },
  ],
  credits: { available: false, balance: 0 },
  fetchedAt: new Date(Date.now() - 60000).toISOString(),
  cached: false,
  stale: false,
};

const mockQuotaStale: QuotaSnapshot = {
  ...mockQuotaSufficient,
  title: '缓存额度 (数据过期展示)',
  stale: true,
  fetchedAt: new Date(Date.now() - 3600000).toISOString(),
};

const mockQuotaUnavailable: QuotaSnapshot = {
  source: 'unavailable',
  accountName: null,
  email: null,
  planTier: null,
  title: '额度服务暂不可用',
  description: null,
  groups: [],
  credits: { available: false, balance: null },
  fetchedAt: new Date().toISOString(),
  cached: false,
  stale: false,
};

const mockAccountsSnapshot: Account[] = [
  {
    name: 'work-prod',
    type: 'oauth',
    isolation: 'credential_snapshot',
    email: 'developer@antigravity.corp',
    note: '工作区主力开发账号',
    savedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    active: true,
    activeRuns: 2,
  },
  {
    name: 'personal-beta',
    type: 'apikey',
    isolation: 'credential_snapshot',
    email: 'alex@personal.me',
    note: '个人实验 API Key',
    savedAt: new Date(Date.now() - 86400000 * 12).toISOString(),
    active: false,
    activeRuns: 0,
  },
];

const mockWhoamiSnapshot: WhoAmI = {
  activeProfile: 'work-prod',
  email: 'developer@antigravity.corp',
  accountType: 'oauth',
  isolation: 'credential_snapshot',
  credentialPresent: true,
};

// ============================================================================
// PlaygroundView Component
// ============================================================================

export function generateDenseTimelineItems(count: number): TimelineItem[] {
  const items: TimelineItem[] = [];
  const baseTime = Date.now() - count * 1000;

  for (let i = 0; i < count; i++) {
    const time = new Date(baseTime + i * 1000).toISOString();
    const mod = i % 8;
    switch (mod) {
      case 0:
        items.push({
          id: `dense-user-${i}`,
          kind: 'user_message',
          type: 'user_message',
          messageId: `msg-u-${i}`,
          text: `用户指令 #${i + 1}: 请分析模块性能瓶颈并执行自动化基准测试套件。`,
          attachments: [],
          runId: `run-${Math.floor(i / 8)}`,
          createdAt: time,
        });
        break;
      case 1:
        items.push({
          id: `dense-think-${i}`,
          kind: 'thinking',
          type: 'thinking',
          blockId: `blk-${i}`,
          source: 'stream',
          text: `正在分析第 ${i + 1} 步的 AST 解析树结构与依赖拓扑关系……`,
          startedAt: time,
          endedAt: time,
          durationMs: 3200,
          isComplete: true,
          runId: `run-${Math.floor(i / 8)}`,
        });
        break;
      case 2:
        items.push({
          id: `dense-tool-fe-${i}`,
          kind: 'tool',
          type: 'tool',
          toolCallId: `tc-fe-${i}`,
          tool: {
            toolCallId: `tc-fe-${i}`,
            name: 'edit_file',
            kind: 'edit_file',
            input: { path: `src/core/module_${i}.ts` },
            target: `src/core/module_${i}.ts`,
            output: 'Applied modifications successfully.',
            error: null,
            status: 'succeeded',
            fileChanges: [
              {
                path: `src/core/module_${i}.ts`,
                changeType: 'modified',
                additions: 12,
                deletions: 4,
              },
            ],
            startedAt: time,
            endedAt: time,
          },
          subagents: [],
          runId: `run-${Math.floor(i / 8)}`,
          createdAt: time,
          updatedAt: time,
        });
        break;
      case 3:
        items.push({
          id: `dense-tool-cmd-${i}`,
          kind: 'tool',
          type: 'tool',
          toolCallId: `tc-cmd-${i}`,
          tool: {
            toolCallId: `tc-cmd-${i}`,
            name: 'run_command',
            kind: 'run_command',
            input: { command: `npm run test -- --filter=module_${i}` },
            target: `npm run test -- --filter=module_${i}`,
            output: `✓ module_${i}.test.ts (8 tests passed in 42ms)`,
            error: null,
            status: 'succeeded',
            fileChanges: [],
            startedAt: time,
            endedAt: time,
          },
          subagents: [],
          runId: `run-${Math.floor(i / 8)}`,
          createdAt: time,
          updatedAt: time,
        });
        break;
      case 4:
        items.push({
          id: `dense-tg-${i}`,
          kind: 'tool_group',
          type: 'tool_group',
          tools: [
            {
              id: `dense-tg-sub1-${i}`,
              kind: 'tool',
              type: 'tool',
              toolCallId: `tc-sub1-${i}`,
              tool: {
                toolCallId: `tc-sub1-${i}`,
                name: 'view_file',
                kind: 'view_file',
                input: { path: `src/utils/calc_${i}.ts` },
                target: `src/utils/calc_${i}.ts`,
                output: '// 45 lines',
                error: null,
                status: 'succeeded',
                fileChanges: [],
                startedAt: time,
                endedAt: time,
              },
              subagents: [],
              runId: `run-${Math.floor(i / 8)}`,
              createdAt: time,
              updatedAt: time,
            },
            {
              id: `dense-tg-sub2-${i}`,
              kind: 'tool',
              type: 'tool',
              toolCallId: `tc-sub2-${i}`,
              tool: {
                toolCallId: `tc-sub2-${i}`,
                name: 'search',
                kind: 'search',
                input: { query: `benchmark_${i}` },
                target: `benchmark_${i}`,
                output: 'Found 4 matches in 2 files',
                error: null,
                status: 'succeeded',
                fileChanges: [],
                startedAt: time,
                endedAt: time,
              },
              subagents: [],
              runId: `run-${Math.floor(i / 8)}`,
              createdAt: time,
              updatedAt: time,
            },
          ],
          runId: `run-${Math.floor(i / 8)}`,
          createdAt: time,
          updatedAt: time,
        });
        break;
      case 5:
        items.push({
          id: `dense-sub-${i}`,
          kind: 'subagent',
          type: 'subagent',
          conversationId: `conv-dense-sub-${i}`,
          role: 'Benchmarker',
          typeName: 'benchmark-agent',
          initialPrompt: `Execute throughput latency profiling for batch ${i}.`,
          status: 'completed',
          parentToolCallId: null,
          runId: `run-${Math.floor(i / 8)}`,
          createdAt: time,
          updatedAt: time,
          steps: [
            {
              stepIndex: 0,
              type: 'thought',
              status: 'ok',
              createdAt: time,
              content: null,
              thinking: 'Profiling throughput…',
              toolCalls: [],
              error: null,
            },
            {
              stepIndex: 1,
              type: 'message',
              status: 'ok',
              createdAt: time,
              content: `Throughput: ${5000 + (i * 17) % 3000} ops/sec, p99 latency 1.4ms.`,
              thinking: null,
              toolCalls: [],
              error: null,
            },
          ],
        });
        break;
      case 6:
        items.push({
          id: `dense-asst-${i}`,
          kind: 'assistant_message',
          type: 'assistant_message',
          messageId: `msg-a-${i}`,
          text: `第 ${i + 1} 轮分析已完成：所有单元测试与基准测试均在预期指标内。\n\n\`\`\`typescript\nexport const step_${i} = { completed: true, index: ${i} };\n\`\`\``,
          isComplete: true,
          runId: `run-${Math.floor(i / 8)}`,
          createdAt: time,
          updatedAt: time,
        });
        break;
      case 7:
      default:
        items.push({
          id: `dense-rd-${i}`,
          kind: 'run_divider',
          type: 'run_divider',
          runId: `run-${Math.floor(i / 8)}`,
          status: 'completed',
          durationMs: 4200,
          usage: {
            inputTokens: 1200 + i * 10,
            outputTokens: 350,
            thinkingTokens: 120,
            cacheReadTokens: 800,
            totalTokens: 1670 + i * 10,
          },
          error: null,
          agyConversationId: `conv-${i}`,
          timestamp: time,
        });
        break;
    }
  }

  return items;
}

export function PlaygroundView() {
  const [hideThinking, setHideThinking] = useState(false);
  const [denseItems, setDenseItems] = useState<TimelineItem[]>(() => generateDenseTimelineItems(20));
  const [isStreaming, setIsStreaming] = useState(false);
  const streamTimerRef = React.useRef<any>(null);

  React.useEffect(() => {
    return () => {
      if (streamTimerRef.current) {
        clearInterval(streamTimerRef.current);
      }
    };
  }, []);

  const handleGenerateDense2000 = () => {
    const items = generateDenseTimelineItems(2000);
    setDenseItems(items);
  };

  const handleToggleStreaming = () => {
    if (isStreaming) {
      if (streamTimerRef.current) clearInterval(streamTimerRef.current);
      setIsStreaming(false);
    } else {
      setIsStreaming(true);
      let stepCount = 0;
      streamTimerRef.current = setInterval(() => {
        stepCount++;
        setDenseItems((prev) => {
          const nowStr = new Date().toISOString();
          const last = prev[prev.length - 1];
          if (
            last &&
            last.kind === 'assistant_message' &&
            !(last as AssistantMessageItem).isComplete
          ) {
            const updated: AssistantMessageItem = {
              ...(last as AssistantMessageItem),
              text: (last as AssistantMessageItem).text + ` · 流式数据帧 #${stepCount}`,
              updatedAt: nowStr,
            };
            return [...prev.slice(0, -1), updated];
          }
          const newMsg: AssistantMessageItem = {
            id: `stream-msg-${Date.now()}-${stepCount}`,
            kind: 'assistant_message',
            type: 'assistant_message',
            messageId: `msg-${Date.now()}`,
            text: `[流式实时追加 #${stepCount}] 收到连续事件推流，平滑跟随不跳动。`,
            isComplete: stepCount % 5 === 0,
            runId: 'playground-stream-run',
            createdAt: nowStr,
            updatedAt: nowStr,
          };
          return [...prev, newMsg];
        });
      }, 70);
    }
  };

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
                <ModelPicker
                  value="gemini-3.8-flash-high"
                  models={[
                    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', group: 'gemini', isDefault: true },
                    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)', group: 'third_party', isDefault: false },
                  ]}
                  onChange={() => {}}
                />
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

        {/* 8. Quota & Account Showcase (模块 2.11) */}
        <section className="space-y-6" data-testid="quota-account-showcase">
          <div className="border-b border-border-default pb-2">
            <h2 className="text-sm font-semibold tracking-wide text-text-secondary uppercase">
              8. 额度与账号组件 Showcase (模块 2.11)
            </h2>
            <p className="text-xs text-text-tertiary mt-1">
              展示 QuotaRing 环形指示器、QuotaPanel 5 种状态（充足、紧张、告警、过期、不可用）以及 AccountMenu 隔离模式与切换逻辑。
            </p>
          </div>

          {/* 8.1 QuotaRing 环形状态演示 */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-text-secondary">
              8.1 QuotaRing 顶栏环形指示器（点击可展开面板）：
            </h3>
            <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border-default bg-bg-surface/40 p-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-tertiary">充足 (&gt;50% 绿):</span>
                <QuotaRing snapshot={mockQuotaSufficient} />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-text-tertiary">紧张 (20-50% 黄):</span>
                <QuotaRing snapshot={mockQuotaTight} />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-text-tertiary">告警 (&lt;20% 红):</span>
                <QuotaRing snapshot={mockQuotaCritical} />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-text-tertiary">不可用 (灰色问号):</span>
                <QuotaRing snapshot={mockQuotaUnavailable} />
              </div>

              <div className="flex items-center gap-2 border-l border-border-subtle pl-4">
                <span className="text-xs text-text-tertiary">无数据:</span>
                <QuotaRing snapshot={null} />
              </div>
            </div>
          </div>

          {/* 8.2 AccountMenu 账号菜单演示 */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-text-secondary">
              8.2 AccountMenu 账号下拉菜单（支持单凭据切换与独立主目录两种模式）：
            </h3>
            <div className="flex flex-wrap items-center gap-8 rounded-lg border border-border-default bg-bg-surface/40 p-4">
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-tertiary">凭据快照模式 (credential_snapshot):</span>
                <AccountMenu
                  accounts={mockAccountsSnapshot}
                  whoami={mockWhoamiSnapshot}
                />
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-text-tertiary">独立主目录模式 (isolated_home):</span>
                <AccountMenu
                  accounts={mockAccountsSnapshot.map((a) => ({
                    ...a,
                    isolation: 'isolated_home' as const,
                  }))}
                  whoami={{
                    ...mockWhoamiSnapshot,
                    isolation: 'isolated_home',
                  }}
                />
              </div>
            </div>
          </div>

          {/* 8.3 QuotaPanel 各种状态视觉效果 */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-text-secondary">
              8.3 QuotaPanel 额度面板五大状态视觉呈现：
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* 状态 1: 充足状态 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-status-success">
                  <span className="h-2 w-2 rounded-full bg-status-success" />
                  <span>状态 1: 充足状态 (&gt;50% 绿色)</span>
                </div>
                <QuotaPanel
                  snapshot={mockQuotaSufficient}
                  className="w-full shadow-md"
                  onClose={() => alert('关闭充足状态面板')}
                  onRefresh={async () => alert('触发刷新')}
                />
              </div>

              {/* 状态 2: 紧张状态 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-status-warning">
                  <span className="h-2 w-2 rounded-full bg-status-warning" />
                  <span>状态 2: 紧张状态 (20% - 50% 黄色)</span>
                </div>
                <QuotaPanel
                  snapshot={mockQuotaTight}
                  className="w-full shadow-md"
                  onClose={() => alert('关闭紧张状态面板')}
                />
              </div>

              {/* 状态 3: 告警临界 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-status-error">
                  <span className="h-2 w-2 rounded-full bg-status-error" />
                  <span>状态 3: 告警状态 (&lt;20% 红色)</span>
                </div>
                <QuotaPanel
                  snapshot={mockQuotaCritical}
                  className="w-full shadow-md"
                  onClose={() => alert('关闭告警状态面板')}
                />
              </div>

              {/* 状态 4: 过期状态 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-color-warning">
                  <span className="h-2 w-2 rounded-full bg-color-warning" />
                  <span>状态 4: 过期状态 (stale: true 告警提示)</span>
                </div>
                <QuotaPanel
                  snapshot={mockQuotaStale}
                  className="w-full shadow-md"
                  onClose={() => alert('关闭过期状态面板')}
                />
              </div>

              {/* 状态 5: 不可用状态 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-text-tertiary">
                  <span className="h-2 w-2 rounded-full bg-text-tertiary" />
                  <span>状态 5: 不可用状态 (source: 'unavailable')</span>
                </div>
                <QuotaPanel
                  snapshot={mockQuotaUnavailable}
                  className="w-full shadow-md"
                  onClose={() => alert('关闭不可用面板')}
                />
              </div>
            </div>
          </div>
        </section>

        {/* 11. 虚拟滚动 2000+ 密集条目与流式追加模拟 (模块 2.13 对话视图组装) */}
        <section className="space-y-4" data-testid="virtual-scrolling-showcase">
          <div className="border-b border-border-default pb-2">
            <h2 className="text-sm font-semibold tracking-wide text-text-secondary uppercase">
              11. 虚拟滚动 2000+ 密集条目与流式追加模拟 (模块 2.13)
            </h2>
            <p className="mt-1 text-xs text-text-tertiary">
              验证 @tanstack/react-virtual 在超大规模列表下的流畅渲染；动态高度测量自适应；距底部 &lt;80px 自动跟随与平滑定位，以及上滑出现“回到底部”指示。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleGenerateDense2000}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-accent/90 transition-colors"
              data-testid="generate-dense-btn"
            >
              🚀 生成 2000+ 条密集时间线数据
            </button>

            <button
              type="button"
              onClick={handleToggleStreaming}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                isStreaming
                  ? 'bg-amber-600 text-white hover:bg-amber-700'
                  : 'border border-border-default bg-bg-surface text-text-primary hover:border-border-strong'
              }`}
              data-testid="toggle-streaming-btn"
            >
              {isStreaming ? '⏸ 停止流式模拟' : '▶ 开始流式追加模拟 (70ms/帧)'}
            </button>

            <button
              type="button"
              onClick={() => setDenseItems([])}
              className="rounded-lg border border-border-default bg-bg-surface px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              清空
            </button>

            <span className="font-mono text-xs text-text-tertiary">
              当前条目总数: <strong className="text-accent">{denseItems.length}</strong> 条
            </span>
          </div>

          {/* 嵌入 ManagerView 容器 */}
          <div className="h-[640px] rounded-xl border border-border-default bg-bg-panel overflow-hidden shadow-2xl flex flex-col">
            <EmbeddedManagerView
              initialItems={denseItems}
              sessionId="playground-dense-session"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
