import fs from 'node:fs';
import path from 'node:path';
import type { AgentMode, Model } from '@agy-studio/contracts';
import type { ModelCatalogPort } from './ports/model-catalog.port.js';
import type { PrefsService } from './prefs.js';
import type { AppConfig } from '../utils/config.js';
import { AppError } from '../utils/errors.js';

export const DEFAULT_MODEL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const MODELS_CACHE_FILE = 'models-cache.json';

export interface ModelServiceOptions {
  catalogPort: ModelCatalogPort;
  prefsService: PrefsService;
  config?: AppConfig;
  cacheTtlMs?: number;
  /** Restore live CLI credentials from the default account snapshot before listing, if needed. */
  ensureCredentials?: () => Promise<void>;
}

export interface ListModelsOptions {
  refresh?: boolean;
}

export class ModelService {
  private readonly catalogPort: ModelCatalogPort;
  private readonly prefsService: PrefsService;
  private readonly config?: AppConfig;
  private readonly cacheTtlMs: number;
  private readonly ensureCredentials?: () => Promise<void>;

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
      this.ensureCredentials = opts.ensureCredentials;
    }
    this.cachedModels = this.readDiskCache();
    if (this.cachedModels) {
      this.cacheExpiresAt = Date.now() + this.cacheTtlMs;
    }
  }

  private diskCachePath(): string | null {
    if (!this.config?.dataDir) return null;
    return path.join(this.config.dataDir, MODELS_CACHE_FILE);
  }

  private readDiskCache(): Model[] | null {
    const file = this.diskCachePath();
    if (!file || !fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { models?: Model[] };
      return Array.isArray(parsed.models) && parsed.models.length > 0 ? parsed.models : null;
    } catch {
      return null;
    }
  }

  private writeDiskCache(models: Model[]): void {
    const file = this.diskCachePath();
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ models, savedAt: new Date().toISOString() }));
    } catch {
      // cache is best-effort
    }
  }

  /**
   * Lists available models with 10-minute in-memory caching.
   * Forces refresh when options.refresh is true.
   * isDefault is calculated dynamically according to prefs.defaultModel,
   * falling back to the first 'gemini' model, or the first model overall.
   */
  private wrapCatalogError(err: unknown): AppError {
    if (err instanceof AppError) return err;
    const e = err as { code?: string; message?: string };
    if (e?.code === 'AGY_NOT_INSTALLED' || e?.code === 'AGY_NOT_AUTHENTICATED') {
      return new AppError(e.code as 'AGY_NOT_INSTALLED' | 'AGY_NOT_AUTHENTICATED', e.message ?? 'Catalog failed', {
        cause: err,
      });
    }
    return new AppError('AGY_NOT_INSTALLED', `Failed to list models: ${e?.message ?? String(err)}`, {
      cause: err,
    });
  }

  async listModels(options: ListModelsOptions = {}): Promise<Model[]> {
    const now = Date.now();
    const shouldRefresh = options.refresh || now >= this.cacheExpiresAt || !this.cachedModels;

    if (shouldRefresh) {
      const haveCache = Boolean(this.cachedModels && this.cachedModels.length > 0);
      if (this.ensureCredentials && (!haveCache || options.refresh)) {
        try {
          await this.ensureCredentials();
        } catch {
          // listing may still succeed from live CLI or disk cache
        }
      }

      let rawModels: Model[] | null = null;
      let lastError: unknown;
      try {
        rawModels = await this.catalogPort.listModels(this.config?.agyBin);
      } catch (err: unknown) {
        lastError = err;
      }

      if (rawModels) {
        this.cachedModels = rawModels;
        this.cacheExpiresAt = now + this.cacheTtlMs;
        this.writeDiskCache(rawModels);
      } else if (this.cachedModels && this.cachedModels.length > 0) {
        this.cacheExpiresAt = now + this.cacheTtlMs;
      } else if (lastError) {
        throw this.wrapCatalogError(lastError);
      }
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
