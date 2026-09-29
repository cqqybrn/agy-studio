import { expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export interface TestContext {
  tempDir: string;
  dataDir: string;
  homeDir: string;
  workspaceDir: string;
}

/**
 * 获取测试服务端上下文信息
 */
export async function getTestContext(page: Page): Promise<TestContext> {
  const res = await page.request.get('/test-api/context');
  expect(res.ok()).toBe(true);
  return res.json() as Promise<TestContext>;
}

/**
 * 确保工作区处于就绪状态（优先复用已有工作区）
 */
export async function ensureWorkspace(page: Page): Promise<void> {
  const currentWsElem = page.locator('[data-testid="workspace-select"]');
  await expect(currentWsElem).toBeVisible({ timeout: 15000 });
}

/**
 * 在页面上新建一个全新的工作区
 */
export async function createNewWorkspace(
  page: Page,
  subDirName: string,
  displayName: string
): Promise<void> {
  const ctx = await getTestContext(page);
  const targetDir = path.join(ctx.workspaceDir, subDirName);
  
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    try {
      execSync('git init', { cwd: targetDir, stdio: 'ignore' });
      execSync('git config user.name "E2E Tester"', { cwd: targetDir, stdio: 'ignore' });
      execSync('git config user.email "tester@example.com"', { cwd: targetDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(targetDir, 'README.md'), `# ${displayName}\n`);
      execSync('git add .', { cwd: targetDir, stdio: 'ignore' });
      execSync('git commit -m "init"', { cwd: targetDir, stdio: 'ignore' });
    } catch {
      // ignore
    }
  }

  // 打开工作区下拉菜单
  const switcherBtn = page.locator('[data-testid="workspace-switcher-btn"]');
  await switcherBtn.click();
  const dropdown = page.locator('[data-testid="workspace-dropdown-menu"]');
  await expect(dropdown).toBeVisible();

  // 点击添加工作区按钮
  const addBtn = page.locator('[data-testid="add-workspace-btn"]');
  await addBtn.click();

  const dialog = page.locator('[data-testid="add-workspace-dialog"]');
  await expect(dialog).toBeVisible();

  // 填入路径和名称
  await page.fill('[data-testid="workspace-path-input"]', targetDir);
  await page.fill('[data-testid="workspace-name-input"]', displayName);
  await page.click('[data-testid="create-workspace-submit"]');

  await expect(dialog).toBeHidden({ timeout: 15000 });
}

/**
 * 创建全新的独立会话
 */
export async function createIndependentSession(page: Page): Promise<void> {
  const newSessionBtn = page.locator('[data-testid="new-session-btn"]');
  await expect(newSessionBtn).toBeVisible();
  await newSessionBtn.click();

  // 如果有账号选择弹窗，点击确认
  const dialog = page.locator('[data-testid="select-account-dialog"]');
  if (await dialog.isVisible()) {
    await page.click('[data-testid="confirm-create-session-btn"]');
  }

  // 等待输入框准备好
  const textarea = page.locator('[data-testid="composer-textarea"]');
  await expect(textarea).toBeVisible({ timeout: 15000 });
}

/**
 * 发送消息并等待响应开始
 */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const textarea = page.locator('[data-testid="composer-textarea"]');
  await textarea.fill(text);
  const sendBtn = page.locator('[data-testid="composer-send-button"]');
  await expect(sendBtn).toBeEnabled();
  await sendBtn.click();
}
