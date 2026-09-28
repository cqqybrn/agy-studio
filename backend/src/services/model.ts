import type { AgentMode, Model } from '@agy-studio/contracts';
import type { ModelCatalogPort } from './ports/model-catalog.port.js';
import type { PrefsService } from './prefs.js';
import type { AppConfig } from '../utils/config.js';
import { AppError } from '../utils/errors.js';

export const DEFAULT_MODEL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface ModelServiceOptions {
  catalogPort: ModelCatalogPort;
  prefsService: PrefsService;
  config?: AppConfig;
  cacheTtlMs?: number;
}

export interface ListModelsOptions {
  refresh?: boolean;
}

export class ModelService {
  private readonly catalogPort: ModelCatalogPort;
  private readonly prefsService: PrefsService;
  private readonly config?: AppConfig;
  private readonly cacheTtlMs: number;

  private cachedModels: Model[] | null = null;
  private cacheExpiresAt = 0;

  constructor(
    options: ModelServiceOptions | ModelCatalogPort,
    prefsService?: PrefsService,
    config?: AppConfig,
  ) {
    if (options && 'listModels' in options) {
      this.catalogPort = options as ModelCatalogPort;
      this.prefsService = prefsService!;
      this.config = config;
      this.cacheTtlMs = DEFAULT_MODEL_CACHE_TTL_MS;
    } else {
      const opts = options as ModelServiceOptions;
      this.catalogPort = opts.catalogPort;
      this.prefsService = opts.prefsService;
      this.config = opts.config;
      this.cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_MODEL_CACHE_TTL_MS;
    }
  }

  /**
   * Lists available models with 10-minute in-memory caching.
   * Forces refresh when options.refresh is true.
   * isDefault is calculated dynamically according to prefs.defaultModel,
   * falling back to the first 'gemini' model, or the first model overall.
   */
  async listModels(options: ListModelsOptions = {}): Promise<Model[]> {
    const now = Date.now();
    const shouldRefresh = options.refresh || !this.cachedModels || now >= this.cacheExpiresAt;

    if (shouldRefresh) {
      let rawModels: Model[];
      try {
        rawModels = await this.catalogPort.listModels(this.config?.agyBin);
      } catch (err: any) {
        if (err instanceof AppError && err.code === 'AGY_NOT_INSTALLED') {
          throw err;
        }
        if (err?.code === 'AGY_NOT_INSTALLED') {
          throw new AppError('AGY_NOT_INSTALLED', err?.message ?? 'Agy CLI is not installed', {
            cause: err,
          });
        }
        throw new AppError(
          'AGY_NOT_INSTALLED',
          `Failed to list models: ${err?.message ?? String(err)}`,
          { cause: err },
        );
      }

      this.cachedModels = rawModels;
      this.cacheExpiresAt = now + this.cacheTtlMs;
    }

    const prefs = await this.prefsService.getPrefs();
    const models = this.cachedModels ?? [];

    if (models.length === 0) {
      return [];
    }

    let defaultModelId: string | null = null;
    if (prefs.defaultModel && models.some((m) => m.id === prefs.defaultModel)) {
      defaultModelId = prefs.defaultModel;
    } else {
      const firstGemini = models.find((m) => m.group === 'gemini');
      if (firstGemini) {
        defaultModelId = firstGemini.id;
      } else {
        defaultModelId = models[0].id;
      }
    }

    return models.map((m) => ({
      ...m,
      isDefault: m.id === defaultModelId,
    }));
  }

  async listModes(): Promise<AgentMode[]> {
    return this.catalogPort.listModes();
  }

  clearCache(): void {
    this.cachedModels = null;
    this.cacheExpiresAt = 0;
  }
}
