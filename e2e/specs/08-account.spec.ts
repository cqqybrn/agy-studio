import { test, expect } from '@playwright/test';
import { waitForNoActiveRuns } from './helpers';

test.describe('08. 账号管理与假终端登录', () => {
  test('通过假终端登录成功添加并保存新账号', async ({ page }) => {
    await page.goto('/');

    // 有运行时登录会被拒绝（ACCOUNT_BUSY），先等前面用例留下的运行结束
    await waitForNoActiveRuns(page);

    // 导航至账号页面
    const navAccountsBtn = page.locator('nav button:has-text("账号")');
    await expect(navAccountsBtn).toBeVisible({ timeout: 15000 });
    await navAccountsBtn.click();

    const accountsView = page.locator('[data-testid="accounts-view"]');
    await expect(accountsView).toBeVisible({ timeout: 15000 });

    // 点击登录新账号按钮
    const loginNewBtn = page.locator('[data-testid="login-new-account-btn"]');
    await expect(loginNewBtn).toBeVisible({ timeout: 15000 });
    await loginNewBtn.click();

    // 验证登录弹窗出现
    const modal = page.locator('[data-testid="login-modal"]');
    await expect(modal).toBeVisible({ timeout: 15000 });

    // 输入保存名称并点击开始登录
    const saveAsInput = page.locator('[data-testid="save-as-input"]');
    await saveAsInput.fill('work-e2e-account');

    const startSubmit = page.locator('[data-testid="start-login-submit"]');
    await startSubmit.click();

    // 等待后端假终端模拟授权完成并展示成功状态
    await expect(modal.locator('[data-testid="login-success-step"]')).toBeVisible({ timeout: 25000 });

    // 点击完成按钮关闭弹窗
    const completeBtn = modal.locator('[data-testid="login-complete-btn"]');
    if (await completeBtn.isVisible()) {
      await completeBtn.click();
    } else {
      const closeBtn = page.locator('[data-testid="close-login-modal"]');
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      }
    }

    // 验证账号列表中出现新添加的账号
    const table = page.locator('[data-testid="accounts-table"]');
    await expect(table).toContainText('work-e2e-account', { timeout: 15000 });
  });
});
