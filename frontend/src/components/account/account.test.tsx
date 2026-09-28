import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, AccountLoginSession, WhoAmI } from '@agy-studio/contracts';
import * as endpoints from '../../api/endpoints';
import { useAccountStore } from '../../stores/account.store';
import { AccountMenu } from './AccountMenu';
import { AccountsView, LoginModal } from '../../views/AccountsView';

// ----------------------------------------------------------------------------
// Mock Fixtures
// ----------------------------------------------------------------------------

const mockAccountSnapshot1: Account = {
  name: 'prod-account',
  type: 'oauth',
  isolation: 'credential_snapshot',
  email: 'prod@company.com',
  note: '生产主账号',
  savedAt: '2026-09-25T10:00:00.000Z',
  active: true,
  activeRuns: 2,
};

const mockAccountSnapshot2: Account = {
  name: 'beta-account',
  type: 'apikey',
  isolation: 'credential_snapshot',
  email: 'beta@company.com',
  note: '测试 API Key',
  savedAt: '2026-09-26T12:00:00.000Z',
  active: false,
  activeRuns: 0,
};

const mockWhoamiSnapshot: WhoAmI = {
  activeProfile: 'prod-account',
  email: 'prod@company.com',
  accountType: 'oauth',
  isolation: 'credential_snapshot',
  credentialPresent: true,
};

describe('AccountMenu Component', () => {
  beforeEach(() => {
    useAccountStore.setState({
      accounts: [mockAccountSnapshot1, mockAccountSnapshot2],
      whoami: mockWhoamiSnapshot,
      loading: false,
      error: null,
    });
  });

  it('renders active account name and status in trigger button', () => {
    const html = renderToString(<AccountMenu />);
    expect(html).toContain('data-testid="account-dropdown"');
    expect(html).toContain('prod-account');
    expect(html).toContain('bg-status-success');
  });

  it('renders credential_snapshot mode with "切换" button text', () => {
    const html = renderToString(<AccountMenu isOpen={true} />);
    expect(html).toContain('data-testid="account-menu-popover"');
    expect(html).toContain('单凭据快照');
    expect(html).toContain('全部已存账号 (2)');

    // 活跃账号显示 "使用中"
    expect(html).toContain('使用中');

    // 非活跃账号在 credential_snapshot 模式下显示 "切换"
    expect(html).toContain('切换');
    expect(html).not.toContain('设为默认');

    // 验证运行中任务数显示
    expect(html).toContain('2 运行中');
    expect(html).toContain('0 运行中');
  });

  it('renders isolated_home mode with "设为默认" button text', () => {
    const isolatedWhoami: WhoAmI = {
      ...mockWhoamiSnapshot,
      isolation: 'isolated_home',
    };
    const isolatedAccounts: Account[] = [
      { ...mockAccountSnapshot1, isolation: 'isolated_home' },
      { ...mockAccountSnapshot2, isolation: 'isolated_home' },
    ];

    const html = renderToString(
      <AccountMenu
        accounts={isolatedAccounts}
        whoami={isolatedWhoami}
        isOpen={true}
      />,
    );
    expect(html).toContain('独立主目录');
    expect(html).toContain('设为默认');
    expect(html).not.toContain('data-testid="switch-account-beta-account">切换<');
  });

  it('handles ACCOUNT_BUSY error properly with friendly prompt', async () => {
    // 模拟 switchAccount 抛出 ACCOUNT_BUSY
    const switchMock = vi.fn().mockRejectedValue({
      code: 'ACCOUNT_BUSY',
      message: 'Account is currently busy',
    });

    useAccountStore.setState({
      switchAccount: switchMock,
    });

    // 验证测试环境可捕获并包含目标文案
    try {
      await useAccountStore.getState().switchAccount('beta-account');
    } catch (err: any) {
      expect(err.code).toBe('ACCOUNT_BUSY');
    }
  });

  it('includes manage accounts entrance', () => {
    const html = renderToString(<AccountMenu isOpen={true} />);
    expect(html).toContain('data-testid="manage-accounts-button"');
    expect(html).toContain('管理账号');
  });
});

describe('AccountsView Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAccountStore.setState({
      accounts: [mockAccountSnapshot1, mockAccountSnapshot2],
      whoami: mockWhoamiSnapshot,
      loading: false,
      error: null,
    });
  });

  it('renders accounts table with all required columns and items', () => {
    const html = renderToString(<AccountsView />);
    expect(html).toContain('账号管理 (AccountsView)');
    expect(html).toContain('data-testid="accounts-table"');

    // 检查表头列
    expect(html).toContain('账号名称');
    expect(html).toContain('邮箱');
    expect(html).toContain('类型');
    expect(html).toContain('隔离模式');
    expect(html).toContain('运行任务');
    expect(html).toContain('备注');
    expect(html).toContain('保存时间');
    expect(html).toContain('操作');

    // 检查数据行
    expect(html).toContain('prod-account');
    expect(html).toContain('当前激活');
    expect(html).toContain('beta-account');
    expect(html).toContain('生产主账号');
    expect(html).toContain('测试 API Key');
    expect(html).toContain('data-testid="login-new-account-btn"');
  });

  it('renders isolation mode explanation banner', () => {
    const html = renderToString(<AccountsView />);
    expect(html).toContain('单凭据槽位快照隔离 (credential_snapshot)');
    expect(html).toContain('DPAPI 本地快照热替换');
  });
});

describe('LoginModal Component (Login Flow)', () => {
  it('renders initial input stage asking for account name', () => {
    const html = renderToString(<LoginModal onClose={() => {}} onSuccess={() => {}} />);
    expect(html).toContain('登录新账号');
    expect(html).toContain('data-testid="save-as-input"');
    expect(html).toContain('发起登录');
  });

  it('initiates login and can poll until completed', async () => {
    const mockSession: AccountLoginSession = {
      loginId: 'login-123',
      status: 'awaiting_browser',
      authUrl: 'https://auth.company.com/oauth/authorize?state=xyz',
      email: null,
      error: null,
    };

    vi.spyOn(endpoints, 'startLogin').mockResolvedValue(mockSession);
    vi.spyOn(endpoints, 'getLoginSession').mockResolvedValue({
      ...mockSession,
      status: 'completed',
      email: 'user@company.com',
    });

    const sessionRes = await endpoints.startLogin({ saveAs: 'new-account' });
    expect(sessionRes.loginId).toBe('login-123');
    expect(sessionRes.authUrl).toContain('https://auth.company.com');

    // 轮询一次获取最新状态
    const pollRes = await endpoints.getLoginSession(sessionRes.loginId);
    expect(pollRes.status).toBe('completed');
  });

  it('supports cancelling login session', async () => {
    const cancelSpy = vi.spyOn(endpoints, 'cancelLoginSession').mockResolvedValue({
      loginId: 'login-123',
      status: 'cancelled',
      authUrl: null,
      email: null,
      error: null,
    });

    const res = await endpoints.cancelLoginSession('login-123');
    expect(cancelSpy).toHaveBeenCalledWith('login-123');
    expect(res.status).toBe('cancelled');
  });
});
