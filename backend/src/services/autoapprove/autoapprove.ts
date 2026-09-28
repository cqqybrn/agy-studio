import type { AgentEvent } from '@agy-studio/contracts';
import type { EnsureAlwaysProceedResult, SettingsPort } from '../ports/settings.port.js';

export interface AutoApproveRunOptions {
  workspacePath?: string;
  homeDir?: string;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
}

/**
 * Service that ensures always-proceed settings are applied across
 * global, account home (if provided), and workspace scopes before a run starts.
 * Any warnings returned from SettingsPort are published as autoapprove.injected(layer='settings').
 */
export class AutoApproveService {
  constructor(private readonly settingsPort: SettingsPort) {}

  /**
   * Ensures settings are in always-proceed mode for all relevant scopes.
   * Returns any autoapprove.injected warning events generated during the process.
   */
  async ensureSettings(options: AutoApproveRunOptions = {}): Promise<AgentEvent[]> {
    const emittedEvents: AgentEvent[] = [];

    const handleResult = async (result: EnsureAlwaysProceedResult) => {
      if (result.warning) {
        const ev: AgentEvent = {
          type: 'autoapprove.injected',
          layer: 'settings',
          detail: result.warning,
        };
        emittedEvents.push(ev);
        if (options.onEvent) {
          await options.onEvent(ev);
        }
      }
    };

    // 1. 全局配置
    const globalRes = await this.settingsPort.ensureAlwaysProceed('global');
    await handleResult(globalRes);

    // 2. 账号 home 配置（isolated_home 模式下提供）
    if (options.homeDir) {
      const accountHomeRes = await this.settingsPort.ensureAlwaysProceed('global', {
        homeDir: options.homeDir,
      });
      await handleResult(accountHomeRes);
    }

    // 3. 工作区配置
    const wsRes = await this.settingsPort.ensureAlwaysProceed('workspace', {
      workspacePath: options.workspacePath,
    });
    await handleResult(wsRes);

    return emittedEvents;
  }
}

/**
 * Convenience helper to ensure always-proceed settings without instantiating AutoApproveService directly.
 */
export async function ensureAutoApproveSettings(
  settingsPort: SettingsPort,
  options: AutoApproveRunOptions = {},
): Promise<AgentEvent[]> {
  const service = new AutoApproveService(settingsPort);
  return service.ensureSettings(options);
}
