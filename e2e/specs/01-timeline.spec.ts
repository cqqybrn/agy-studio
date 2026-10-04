import { test, expect } from '@playwright/test';
import { createNewWorkspace, createIndependentSession, expandWorkedBlocks, sendMessage } from './helpers';

test.describe('01. 时间线展示完整生命周期', () => {
  test('新建工作区与会话并发送消息 → 页面展示思考块、工具卡片、正文回复、分隔条', async ({ page }) => {
    await page.goto('/');

    // 1. 新建独立工作区
    await createNewWorkspace(page, 'timeline-ws', 'Timeline Test Workspace');

    // 2. 创建独立会话
    await createIndependentSession(page);

    // 3. 发送消息
    await sendMessage(page, '请在工作区创建文件并运行测试任务');

    // 4. 等待运行结束后的分隔条（RunDivider）
    const runDivider = page.locator('[data-testid="run-divider"]').first();
    await expect(runDivider).toBeVisible({ timeout: 15000 });

    // 5. 验证正文回复（Markdown）渲染
    const markdownMessage = page.locator('[data-testid="message-markdown"]').first();
    await expect(markdownMessage).toBeVisible({ timeout: 15000 });

    // 6. 思考与工具调用收在 "Worked for Xs" 折叠块里，展开后验证
    await expect(page.locator('[data-testid="worked-block"]').first()).toBeVisible({ timeout: 15000 });
    await expandWorkedBlocks(page);

    const thinkingRow = page.locator('[data-testid="thinking-row"]').first();
    await expect(thinkingRow).toBeVisible({ timeout: 15000 });

    // file-ops 场景触发 write_to_file / view_file / run_command
    const toolRow = page.locator('[data-testid="tool-row"]').first();
    await expect(toolRow).toBeVisible({ timeout: 15000 });
  });
});
