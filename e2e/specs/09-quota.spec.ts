import { test, expect } from '@playwright/test';

test.describe('09. 额度数据显示与面板交互', () => {
  test('顶栏显示额度环并在点击后展开额度面板展示详细数据', async ({ page }) => {
    await page.goto('/');

    // 验证顶栏额度徽标出现
    const quotaBadge = page.locator('[data-testid="quota-badge"]');
    await expect(quotaBadge).toBeVisible({ timeout: 15000 });

    // 点击额度徽标打开额度面板
    await quotaBadge.click();

    // 验证面板出现
    const quotaPanel = page.locator('[data-testid="quota-panel"]');
    await expect(quotaPanel).toBeVisible({ timeout: 10000 });

    // 验证面板内详细内容：计划等级（面板已译成中文）、额度桶等
    await expect(quotaPanel).toContainText('Google AI 专业版');

    const quotaBucket = quotaPanel.locator('[data-testid^="quota-bucket-"]').first();
    await expect(quotaBucket).toBeVisible({ timeout: 10000 });

    // 验证刷新按钮
    const refreshBtn = quotaPanel.locator('[data-testid="refresh-quota-button"]');
    await expect(refreshBtn).toBeVisible();

    // 关闭面板
    const closeBtn = quotaPanel.locator('[data-testid="close-quota-panel"]');
    await closeBtn.click();
    await expect(quotaPanel).toBeHidden({ timeout: 10000 });
  });
});
