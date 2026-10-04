import { test, expect } from '@playwright/test';
import { ensureWorkspace, createIndependentSession, scrollTimelineToTop, sendMessage } from './helpers';

test.describe('07. 编辑重问', () => {
  test('编辑已发送的消息后，之后的回答全部删除并按新内容重新提问', async ({ page }) => {
    await page.goto('/');
    await ensureWorkspace(page);
    await createIndependentSession(page);

    await page.request.post('/test-api/scenario', { data: { scenario: 'file-ops', speed: 0 } });
    await sendMessage(page, '第一个问题：请创建文件');
    await expect(page.locator('[data-testid="run-divider"]')).toHaveCount(1, { timeout: 15000 });

    const userRows = page.locator('[data-testid^="timeline-item-user-"]');
    await scrollTimelineToTop(page);
    await expect(userRows).toHaveCount(1);
    await expect(userRows.first()).toContainText('第一个问题');

    // 悬停后点击"编辑"，修改并发送
    await userRows.first().hover();
    await userRows.first().locator('[data-testid="user-message-edit-btn"]').click();
    const textarea = page.locator('[data-testid="user-message-edit-textarea"]');
    await expect(textarea).toHaveValue('第一个问题：请创建文件');
    await textarea.fill('改过的问题：换一种方式创建文件');
    await page.request.post('/test-api/scenario', { data: { scenario: 'file-ops', speed: 0 } });
    await page.click('[data-testid="user-message-edit-submit"]');

    // 原消息与原回答被删除，只剩新消息和新回答
    await expect(page.locator('[data-testid="user-message-editor"]')).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('[data-testid="run-divider"]')).toHaveCount(1, { timeout: 15000 });
    await scrollTimelineToTop(page);
    await expect(userRows).toHaveCount(1, { timeout: 15000 });
    await expect(userRows.first()).toContainText('改过的问题');
    // 会话标题由第一条消息生成、编辑后不变，所以只在对话区里检查原文已消失
    const timeline = page.locator('[data-testid="timeline-scroll-container"]');
    await expect(timeline.getByText('第一个问题：请创建文件')).toHaveCount(0);
    await expect(page.locator('[data-testid="run-divider"]')).toHaveCount(1, { timeout: 15000 });

    // 后端按原消息请求了一次 agy 回退
    const rewinds = await (await page.request.get('/test-api/rewinds')).json();
    expect(rewinds).toHaveLength(1);
    expect(rewinds[0]).toMatchObject({ messageText: '第一个问题：请创建文件', occurrenceFromEnd: 1 });

    // 刷新后历史仍是编辑后的版本
    await page.reload();
    await page.locator('[data-testid^="inbox-item-"]').first().click();
    await expect(page.locator('[data-testid="run-divider"]')).toHaveCount(1, { timeout: 15000 });
    await scrollTimelineToTop(page);
    await expect(userRows).toHaveCount(1, { timeout: 15000 });
    await expect(userRows.first()).toContainText('改过的问题');
  });

  test('运行中不能编辑', async ({ page }) => {
    await page.goto('/');
    await ensureWorkspace(page);
    await createIndependentSession(page);

    await page.request.post('/test-api/scenario', { data: { scenario: 'file-ops', speed: 1 } });
    await sendMessage(page, '一个比较慢的任务');

    const editBtn = page.locator('[data-testid="user-message-edit-btn"]').first();
    await expect(editBtn).toBeDisabled({ timeout: 15000 });
    await expect(editBtn).toHaveAttribute('title', /运行中无法编辑/);

    // 运行结束后恢复可编辑
    await expect(page.locator('[data-testid="run-divider"]')).toHaveCount(1, { timeout: 30000 });
    await scrollTimelineToTop(page);
    await expect(editBtn).toBeEnabled();
  });
});
