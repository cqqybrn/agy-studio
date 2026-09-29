import { test, expect } from '@playwright/test';
import { ensureWorkspace, createIndependentSession, sendMessage } from './helpers';

test.describe('02. 子 Agent 卡片交互', () => {
  test('展开子 agent 卡片（SubagentCard）展示嵌套步骤', async ({ page }) => {
    await page.goto('/');

    await ensureWorkspace(page);
    await createIndependentSession(page);

    // 显式指定下一个 scenario 为 subagent
    await page.request.post('/test-api/scenario', {
      data: { scenario: 'subagent', speed: 0 },
    });

    // 触发 subagent scenario
    await sendMessage(page, '请启动 subagent 进行依赖分析');

    // 等待子 agent 卡片出现
    const subagentCard = page.locator('[data-testid="subagent-card"]').first();
    await expect(subagentCard).toBeVisible({ timeout: 15000 });

    // 点击展开按钮
    const toggleBtn = subagentCard.locator('[data-testid="subagent-toggle-btn"]');
    await toggleBtn.click();

    // 验证展开后的内容区域及步骤项
    const subagentContent = subagentCard.locator('[data-testid="subagent-content"]');
    await expect(subagentContent).toBeVisible({ timeout: 10000 });

    const subagentStep = subagentContent.locator('[data-testid="subagent-step"]').first();
    await expect(subagentStep).toBeVisible({ timeout: 10000 });
  });
});
