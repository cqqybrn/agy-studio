import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@agy-studio/contracts';
import {
  AutoApproveService,
  ensureAutoApproveSettings,
} from '../../src/services/autoapprove/autoapprove.js';
import type {
  EnsureAlwaysProceedOptions,
  EnsureAlwaysProceedResult,
  SettingsPort,
  SettingsScope,
} from '../../src/services/ports/settings.port.js';

describe('AutoApproveService', () => {
  it('calls ensureAlwaysProceed for global and workspace scopes without homeDir', async () => {
    const calls: Array<{ scope: SettingsScope; options?: EnsureAlwaysProceedOptions }> = [];

    const mockSettingsPort: SettingsPort = {
      async ensureAlwaysProceed(scope, options) {
        calls.push({ scope, options });
        return { updated: true, filePath: `/dummy/${scope}.json` };
      },
      async installStatusline() {},
      async uninstallStatusline() {},
    };

    const service = new AutoApproveService(mockSettingsPort);
    const events = await service.ensureSettings({
      workspacePath: '/my/workspace',
    });

    expect(events).toEqual([]);
    expect(calls).toEqual([
      { scope: 'global', options: undefined },
      { scope: 'workspace', options: { workspacePath: '/my/workspace' } },
    ]);
  });

  it('calls ensureAlwaysProceed for global, account home, and workspace scopes when homeDir is provided', async () => {
    const calls: Array<{ scope: SettingsScope; options?: EnsureAlwaysProceedOptions }> = [];

    const mockSettingsPort: SettingsPort = {
      async ensureAlwaysProceed(scope, options) {
        calls.push({ scope, options });
        return { updated: true, filePath: `/dummy/${scope}.json` };
      },
      async installStatusline() {},
      async uninstallStatusline() {},
    };

    const service = new AutoApproveService(mockSettingsPort);
    const events = await service.ensureSettings({
      workspacePath: '/my/workspace',
      homeDir: '/my/account/home',
    });

    expect(events).toEqual([]);
    expect(calls).toEqual([
      { scope: 'global', options: undefined },
      { scope: 'global', options: { homeDir: '/my/account/home' } },
      { scope: 'workspace', options: { workspacePath: '/my/workspace' } },
    ]);
  });

  it('emits autoapprove.injected(layer="settings") events when warnings occur', async () => {
    const mockSettingsPort: SettingsPort = {
      async ensureAlwaysProceed(scope, options) {
        if (scope === 'workspace') {
          return {
            updated: false,
            filePath: '/ws/settings.json',
            warning: 'Workspace settings write permission denied',
          };
        }
        if (options?.homeDir) {
          return {
            updated: false,
            filePath: '/home/settings.json',
            warning: 'Account home settings file locked',
          };
        }
        return { updated: true, filePath: '/global/settings.json' };
      },
      async installStatusline() {},
      async uninstallStatusline() {},
    };

    const dispatched: AgentEvent[] = [];
    const service = new AutoApproveService(mockSettingsPort);

    const result = await service.ensureSettings({
      workspacePath: '/ws',
      homeDir: '/home',
      onEvent: (ev) => {
        dispatched.push(ev);
      },
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: 'autoapprove.injected',
      layer: 'settings',
      detail: 'Account home settings file locked',
    });
    expect(result[1]).toEqual({
      type: 'autoapprove.injected',
      layer: 'settings',
      detail: 'Workspace settings write permission denied',
    });

    expect(dispatched).toEqual(result);
  });

  it('ensureAutoApproveSettings function helper works identically', async () => {
    const mockSettingsPort: SettingsPort = {
      async ensureAlwaysProceed(scope) {
        return {
          updated: false,
          filePath: '/path',
          warning: `Warning on ${scope}`,
        };
      },
      async installStatusline() {},
      async uninstallStatusline() {},
    };

    const events = await ensureAutoApproveSettings(mockSettingsPort, {
      workspacePath: '/ws',
    });

    expect(events).toHaveLength(2);
    expect((events[0] as any).detail).toBe('Warning on global');
    expect((events[1] as any).detail).toBe('Warning on workspace');
  });
});
