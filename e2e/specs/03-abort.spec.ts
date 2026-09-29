import { test, expect } from '@playwright/test';
import { ensureWorkspace, createIndependentSession } from './helpers';

test.describe('03. 运行中停止 (Abort)', () => {
  test('发送任务并在运行中点击停止按钮成功终止运行', async ({ page }) => {
    await page.goto('/');

    await ensureWorkspace(page);
    await createIndependentSession(page);

    // 显式设置下一个 scenario 为 abort-midway 且速度适中，确保能捕获停止按钮
    await page.request.post('/test-api/scenario', {
      data: { scenario: 'abort-midway', speed: 1 },
    });

    const textarea = page.locator('[data-testid="composer-textarea"]');
    await textarea.fill('请开始一个长时间任务然后 abort');

    const sendBtn = page.locator('[data-testid="composer-send-button"]');
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    // 捕获停止按钮并点击
    const stopBtn = page.locator('[data-testid="composer-stop-button"]');
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
    await stopBtn.click();

    // 验证停止成功，发送按钮恢复可用
    await expect(sendBtn).toBeVisible({ timeout: 15000 });
  });
});
