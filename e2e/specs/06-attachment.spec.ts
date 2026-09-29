import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureWorkspace, createIndependentSession } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('06. 附件上传与发送', () => {
  test('上传图片附件后发送并在时间线正常渲染', async ({ page }) => {
    await page.goto('/');

    await ensureWorkspace(page);
    await createIndependentSession(page);

    const fixtureImage = path.resolve(__dirname, '../fixtures/sample-test.png');

    // 选中图片文件上传
    const fileInput = page.locator('[data-testid="hidden-file-input"]');
    await fileInput.setInputFiles(fixtureImage);

    // 验证 composer 附件列表出现该图片标签
    const attachmentsList = page.locator('[data-testid="attachments-list"]');
    await expect(attachmentsList).toBeVisible({ timeout: 10000 });
    await expect(attachmentsList).toContainText('sample-test.png');

    // 输入文本并发送
    const textarea = page.locator('[data-testid="composer-textarea"]');
    await textarea.fill('请分析这张附带的图片');

    const sendBtn = page.locator('[data-testid="composer-send-button"]');
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    // 验证用户消息条目中渲染了附件信息
    const userMessage = page.locator('[data-testid^="timeline-item-user-"]').first();
    await expect(userMessage).toBeVisible({ timeout: 15000 });
    await expect(userMessage).toContainText('sample-test.png');
  });
});
