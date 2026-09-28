import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CheckpointDiff, CheckpointFileDiff } from '@agy-studio/contracts';
import {
  DiffViewer,
  LARGE_FILE_LINE_THRESHOLD,
  parseUnifiedDiff,
} from './DiffViewer';

describe('DiffViewer & parseUnifiedDiff Unit Tests', () => {
  const samplePatch = `diff --git a/src/utils.ts b/src/utils.ts
index 111..222 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -10,4 +10,5 @@ export function add(a: number, b: number) {
-  return a - b;
+  // Fix calculation
+  return a + b;
 }`;

  const sampleFileDiff: CheckpointFileDiff = {
    path: 'src/utils.ts',
    changeType: 'modified',
    patch: samplePatch,
  };

  const sampleCheckpointDiff: CheckpointDiff = {
    checkpointId: 'cp-test-1',
    files: [sampleFileDiff],
  };

  // ==========================================================================
  // 1. parseUnifiedDiff 核心算法测试
  // ==========================================================================
  describe('parseUnifiedDiff parser', () => {
    it('accurately parses hunk headers, addition, deletion, and context lines with line numbers', () => {
      const parsed = parseUnifiedDiff(samplePatch);

      expect(parsed.additions).toBe(2);
      expect(parsed.deletions).toBe(1);
      expect(parsed.isLarge).toBe(false);

      // 验证行结构
      const hunkLine = parsed.lines.find((l) => l.type === 'hunk');
      expect(hunkLine).toBeDefined();
      expect(hunkLine?.content).toContain('@@ -10,4 +10,5 @@');

      const delLine = parsed.lines.find((l) => l.type === 'del');
      expect(delLine).toBeDefined();
      expect(delLine?.oldLineNumber).toBe(10);
      expect(delLine?.newLineNumber).toBeNull();
      expect(delLine?.content).toBe('-  return a - b;');

      const addLines = parsed.lines.filter((l) => l.type === 'add');
      expect(addLines).toHaveLength(2);
      expect(addLines[0].oldLineNumber).toBeNull();
      expect(addLines[0].newLineNumber).toBe(10);
      expect(addLines[0].content).toBe('+  // Fix calculation');
      expect(addLines[1].oldLineNumber).toBeNull();
      expect(addLines[1].newLineNumber).toBe(11);
      expect(addLines[1].content).toBe('+  return a + b;');

      const normalLines = parsed.lines.filter((l) => l.type === 'normal');
      expect(normalLines.length).toBeGreaterThanOrEqual(1);
    });

    it('identifies large files exceeding the threshold (> 300 lines)', () => {
      // 构造超过 300 行的 patch
      const manyLines = Array.from(
        { length: 350 },
        (_, i) => `+const item_${i} = ${i};`,
      ).join('\n');
      const largePatch = `diff --git a/big.ts b/big.ts\n@@ -0,0 +1,350 @@\n${manyLines}`;

      const parsed = parseUnifiedDiff(largePatch, 300);
      expect(parsed.isLarge).toBe(true);
      expect(parsed.additions).toBe(350);
      expect(parsed.deletions).toBe(0);
    });

    it('handles empty patches and whitespace gracefully', () => {
      const parsed = parseUnifiedDiff('');
      expect(parsed.lines).toHaveLength(0);
      expect(parsed.additions).toBe(0);
      expect(parsed.deletions).toBe(0);
      expect(parsed.isLarge).toBe(false);
    });
  });

  // ==========================================================================
  // 2. DiffViewer 统一 diff 增删着色与行号渲染测试
  // ==========================================================================
  describe('DiffViewer Rendering & Highlighting', () => {
    it('renders addition lines with green coloring and deletion lines with red coloring', () => {
      const html = renderToString(<DiffViewer diff={sampleCheckpointDiff} />);

      // 验证主视图与行渲染
      expect(html).toContain('data-testid="diff-viewer"');
      expect(html).toContain('data-testid="diff-main-view"');
      expect(html).toContain('data-testid="diff-file-src/utils.ts"');

      // 验证新增行与删除行测试 ID 及着色 class
      expect(html).toContain('data-testid="diff-line-add"');
      expect(html).toContain('bg-emerald-500/15');
      expect(html).toContain('text-emerald-300');

      expect(html).toContain('data-testid="diff-line-del"');
      expect(html).toContain('bg-rose-500/15');
      expect(html).toContain('text-rose-300');

      // 验证 hunk 标头
      expect(html).toContain('data-testid="diff-line-hunk"');
      expect(html).toContain('@@ -10,4 +10,5 @@');

      // 验证代码内容文本
      expect(html).toContain('Fix calculation');
      expect(html).toContain('return a + b;');
    });

    it('renders line numbers properly in old-line-number and new-line-number columns', () => {
      const html = renderToString(<DiffViewer diff={sampleCheckpointDiff} />);

      expect(html).toContain('data-testid="old-line-number"');
      expect(html).toContain('data-testid="new-line-number"');
      expect(html).toContain('data-testid="diff-line-content"');

      // 行号列中包含对应数字
      expect(html).toContain('>10</td>');
      expect(html).toContain('>11</td>');
    });

    it('renders empty state when diff has no files', () => {
      const html = renderToString(<DiffViewer diff={{ checkpointId: 'cp-0', files: [] }} />);

      expect(html).toContain('data-testid="diff-empty"');
      expect(html).toContain('暂无文件改动');
    });
  });

  // ==========================================================================
  // 3. 大文件默认折叠与展开功能测试
  // ==========================================================================
  describe('Large File Folding & Expand All', () => {
    const largeAdditions = Array.from(
      { length: 320 },
      (_, i) => `+export const config_${i} = ${i};`,
    ).join('\n');

    const largeFileDiff: CheckpointFileDiff = {
      path: 'src/generated/large-schema.ts',
      changeType: 'created',
      patch: `diff --git a/src/generated/large-schema.ts b/src/generated/large-schema.ts\nnew file mode 100644\n@@ -0,0 +1,320 @@\n${largeAdditions}`,
    };

    it('defaults large files (> 300 lines) to collapsed with a collapse notice and expand button', () => {
      const html = renderToString(
        <DiffViewer
          diff={{
            checkpointId: 'cp-large',
            files: [largeFileDiff],
          }}
          largeThreshold={300}
        />,
      );

      // 包含大文件徽章与折叠提示
      expect(html).toContain('data-testid="large-file-badge-src/generated/large-schema.ts"');
      expect(html).toContain('大文件');
      expect(html).toContain(
        'data-testid="diff-collapsed-notice-src/generated/large-schema.ts"',
      );
      expect(html).toContain('此文件包含超过 300 行修改（大文件），已默认折叠');

      // 包含单文件展开按钮与全局展开全部按钮
      expect(html).toContain(
        'data-testid="expand-single-src/generated/large-schema.ts"',
      );
      expect(html).toContain('展开内容 (Expand)');
      expect(html).toContain('data-testid="expand-all-btn"');
      expect(html).toContain('展开全部 (Expand all)');

      // 默认折叠状态下，不渲染行内容 table
      expect(html).not.toContain(
        'data-testid="diff-lines-src/generated/large-schema.ts"',
      );
    });

    it('renders diff lines when large file is expanded via defaultExpandedMap', () => {
      const html = renderToString(
        <DiffViewer
          diff={{
            checkpointId: 'cp-large',
            files: [largeFileDiff],
          }}
          defaultExpandedMap={{
            'src/generated/large-schema.ts': true,
          }}
          largeThreshold={300}
        />,
      );

      // 展开状态下渲染 diff 详情行
      expect(html).toContain(
        'data-testid="diff-lines-src/generated/large-schema.ts"',
      );
      expect(html).toContain('config_0');
      expect(html).toContain('config_319');
    });
  });

  // ==========================================================================
  // 4. 文件列表侧边栏 (Sidebar) 测试
  // ==========================================================================
  describe('DiffViewer Sidebar & File Tree', () => {
    it('renders sidebar with all changed files, change badges, and addition/deletion counts', () => {
      const multiFiles: CheckpointFileDiff[] = [
        {
          path: 'src/created.ts',
          changeType: 'created',
          patch: 'diff --git a/src/created.ts b/src/created.ts\n@@ -0,0 +1,2 @@\n+a\n+b',
        },
        {
          path: 'src/deleted.ts',
          changeType: 'deleted',
          patch: 'diff --git a/src/deleted.ts b/src/deleted.ts\n@@ -1,2 +0,0 @@\n-x\n-y',
        },
        {
          path: 'src/modified.ts',
          changeType: 'modified',
          patch: samplePatch,
        },
      ];

      const html = renderToString(<DiffViewer files={multiFiles} />);

      expect(html).toContain('data-testid="diff-sidebar"');
      expect(html).toContain('变更文件 (3)');

      expect(html).toContain('data-testid="diff-sidebar-item-src/created.ts"');
      expect(html).toContain('data-testid="diff-sidebar-item-src/deleted.ts"');
      expect(html).toContain('data-testid="diff-sidebar-item-src/modified.ts"');

      // 验证统计与徽章
      expect(html).toContain('+2');
      expect(html).toContain('-2');
      expect(html).toContain('3 个文件变更');
    });
  });
});
