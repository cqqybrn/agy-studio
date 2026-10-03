import { test, expect } from '@playwright/test';
import { ensureWorkspace, createIndependentSession, expandWorkedBlocks, sendMessage } from './helpers';

test.describe('04. 时间线历史完整性', () => {
  test('页面刷新后时间线完整回放历史记录', async ({ page }) => {
    await page.goto('/');

    await ensureWorkspace(page);
    await createIndependentSession(page);

    // 发送消息并等待运行结束
    await sendMessage(page, '创建文件并输出测试数据');

    const runDivider = page.locator('[data-testid="run-divider"]').first();
    await expect(runDivider).toBeVisible({ timeout: 15000 });

    const markdownBefore = page.locator('[data-testid="message-markdown"]').first();
    await expect(markdownBefore).toBeVisible();

    // 页面刷新
    await page.reload();

    // 重新点击选中已保存的历史会话
    const inboxItem = page.locator('[data-testid^="inbox-item-"]').first();
    await expect(inboxItem).toBeVisible({ timeout: 15000 });
    await inboxItem.click();

    // 验证刷新后思考、工具调用、Markdown 正文、运行分隔条依然完整存在
    await expect(page.locator('[data-testid="worked-block"]').first()).toBeVisible({ timeout: 15000 });
    await expandWorkedBlocks(page);

    const thinkingRow = page.locator('[data-testid="thinking-row"]').first();
    await expect(thinkingRow).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="tool-row"]').first()).toBeVisible({ timeout: 15000 });

    const assistantMarkdown = page.locator('[data-testid="message-markdown"]').filter({ hasText: '文件已创建成功' });
    await expect(assistantMarkdown).toBeVisible({ timeout: 15000 });

    const dividerAfter = page.locator('[data-testid="run-divider"]').first();
    await expect(dividerAfter).toBeVisible({ timeout: 15000 });
  });
});
