import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { AccountsView, ManagerView, PlaygroundView, SettingsView } from './views';

describe('App & Layout Component', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      localStorage.clear();
      window.location.hash = '';
    }
  });

  it('renders without crashing and includes core layout sections', () => {
    const html = renderToString(<App />);
    expect(html).toBeDefined();

    // 验证顶栏组件（工作区、模型、额度环、账号菜单、连接状态）
    expect(html).toContain('AGY Studio');
    expect(html).toContain('默认工作区');
    expect(html).toContain('data-testid="model-selector"');
    expect(html).toContain('data-testid="quota-badge"');
    expect(html).toContain('default');
    expect(html).toContain('已连接');

    // 验证三栏布局结构
    expect(html).toContain('data-testid="left-sidebar"');
    expect(html).toContain('data-testid="center-panel"');
    expect(html).toContain('data-testid="right-panel"');
    expect(html).toContain('收件箱');
    expect(html).toContain('Artifacts');
  });

  it('renders placeholder views correctly', () => {
    const managerHtml = renderToString(<ManagerView />);
    expect(managerHtml).toContain('ManagerView');

    const accountsHtml = renderToString(<AccountsView />);
    expect(accountsHtml).toContain('AccountsView');

    const settingsHtml = renderToString(<SettingsView />);
    expect(settingsHtml).toContain('SettingsView');

    const playgroundHtml = renderToString(<PlaygroundView />);
    expect(playgroundHtml).toContain('PlaygroundView');
    expect(playgroundHtml).toContain('Timeline Components Showcase');
    expect(playgroundHtml).toContain('data-testid="markdown-table"');
    expect(playgroundHtml).toContain('data-testid="code-block"');
  });

  it('verifies localStorage interaction logic for right panel settings', () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('agy_studio_right_panel_width', '450');
      localStorage.setItem('agy_studio_right_panel_collapsed', 'true');

      const html = renderToString(<App />);
      expect(html).toContain('data-testid="expand-right-btn"');
    }
  });
});
