import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePrefsStore } from '../stores/prefs.store';
import { parseSetting, SettingsView } from './SettingsView';

describe('SettingsView', () => {
  beforeEach(() => {
    usePrefsStore.setState({
      prefs: {
        defaultModel: null,
        defaultEffort: null,
        defaultMode: null,
        defaultWorkspaceId: null,
        showThinking: true,
        maxConcurrentRuns: 3,
        stallTimeoutSeconds: 180,
      },
    });
  });

  it('shows the settings that take effect with their current values', () => {
    const html = renderToStaticMarkup(<SettingsView />);
    expect(html).toContain('显示模型思考过程');
    expect(html).toContain('aria-checked="true"');
    expect(html).toMatch(/data-testid="setting-stallTimeoutSeconds"[^>]*value="180"|value="180"[^>]*data-testid="setting-stallTimeoutSeconds"/);
    expect(html).toMatch(/value="3"/);
    expect(html).not.toContain('SettingsView)');
  });

  it('validates number settings against their range', () => {
    expect(parseSetting('stallTimeoutSeconds', '240')).toEqual({ value: 240 });
    expect(parseSetting('stallTimeoutSeconds', '5')).toHaveProperty('error');
    expect(parseSetting('maxConcurrentRuns', '2.5')).toHaveProperty('error');
    expect(parseSetting('maxConcurrentRuns', 'abc')).toHaveProperty('error');
    expect(parseSetting('maxConcurrentRuns', '10')).toEqual({ value: 10 });
  });
});
