import { test, expect } from '@playwright/test';
import { ensureWorkspace, createIndependentSession, sendMessage } from './helpers';

test.describe('07. 检查点与回滚', () => {
  test('自动生成检查点并支持二次确认回滚', async ({ page }) => {
    await page.goto('/');

    await ensureWorkspace(page);
    await createIndependentSession(page);

    // 发送消息触发一次运行，生成初始 checkpoint
    await sendMessage(page, '生成新文件以触发检查点');

    const runDivider = page.locator('[data-testid="run-divider"]').first();
    await expect(runDivider).toBeVisible({ timeout: 15000 });

    // 切换至 Changes 标签页
    const changesTab = page.locator('[data-testid="artifact-tab-changes"]');
    await expect(changesTab).toBeVisible({ timeout: 10000 });
    await changesTab.click();

    // 等待检查点列表项出现
    const checkpointItem = page.locator('[data-testid^="checkpoint-item-"]').first();
    await expect(checkpointItem).toBeVisible({ timeout: 15000 });

    // 点击回滚按钮
    const rollbackBtn = checkpointItem.locator('[data-testid^="rollback-btn-"]');
    await rollbackBtn.click();

    // 验证二次确认对话框出现
    const confirmDialog = page.locator('[data-testid="rollback-confirm-dialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: 10000 });

    // 点击确认回滚
    const confirmBtn = page.locator('[data-testid="confirm-rollback-btn"]');
    await confirmBtn.click();

    // 验证回滚成功提示
    const successMsg = page.locator('[data-testid="rollback-success-msg"]');
    await expect(successMsg).toBeVisible({ timeout: 15000 });
  });
});
