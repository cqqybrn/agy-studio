import { test, expect } from '@playwright/test';
import { ensureWorkspace, createIndependentSession, sendMessage } from './helpers';

test.describe('05. 断网与重连', () => {
  test('setOffline 断网与恢复后事件补齐且不重复', async ({ page }) => {
    // 覆盖下一个 scenario 为慢速回放，使运行持续若干秒以模拟中途中断
    await page.request.post('/test-api/scenario', {
      data: { scenario: 'file-ops', speed: 1 },
    });

    await page.goto('/');

    await ensureWorkspace(page);
    await createIndependentSession(page);

    // 确认初始状态正常
    const composerTextarea = page.locator('[data-testid="composer-textarea"]');
    await expect(composerTextarea).toBeVisible({ timeout: 15000 });

    // 发送消息启动运行
    await sendMessage(page, '执行文件操作并验证重连');

    // 等待思考块出现，确认运行已在服务端开始
    const thinkingBlock = page.locator('[data-testid="thinking-block"]').first();
    await expect(thinkingBlock).toBeVisible({ timeout: 15000 });

    // 模拟网络断开
    await page.context().setOffline(true);
    await page.waitForTimeout(1500);

    // 模拟网络恢复
    await page.context().setOffline(false);

    // 验证网络恢复后，服务端未完成/补发的事件正常流转并最终顺利完成
    const runDivider = page.locator('[data-testid="run-divider"]').first();
    await expect(runDivider).toBeVisible({ timeout: 25000 });

    // 验证时间线要素完整（思考块、正文、分隔条各存在且无异常重复崩溃）
    const messageMarkdown = page.locator('[data-testid="message-markdown"]').first();
    await expect(messageMarkdown).toBeVisible({ timeout: 15000 });

    const dividerCount = await page.locator('[data-testid="run-divider"]').count();
    expect(dividerCount).toBe(1);
  });
});


