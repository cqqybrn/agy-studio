import { create } from 'zustand';
import type { Model, Prefs } from '@agy-studio/contracts';
import { getModels } from '../api/endpoints';
import { usePrefsStore } from './prefs.store';

export interface ModelsState {
  models: Model[];
  loading: boolean;
  fetched: boolean;
  error: string | null;

  fetchModels: (refresh?: boolean) => Promise<Model[]>;
}

function modelsErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: string }).code;
    if (code === 'AGY_NOT_AUTHENTICATED') {
      return 'agy 未登录，请到账号页登录后再刷新模型';
    }
    if (code === 'AGY_NOT_INSTALLED') {
      return '未找到 agy，无法加载模型列表';
    }
  }
  return err instanceof Error ? err.message : String(err);
}

export const useModelsStore = create<ModelsState>()((set) => ({
  models: [],
  loading: false,
  fetched: false,
  error: null,

  fetchModels: async (refresh?: boolean) => {
    set({ loading: true, error: null });
    try {
      const models = await getModels(refresh ? { refresh: true } : undefined);
      set({ models, loading: false, fetched: true, error: null });
      return models;
    } catch (err: unknown) {
      set({ loading: false, fetched: true, error: modelsErrorMessage(err) });
      return [];
    }
  },
}));

/** The globally selected model: the user's saved default if it is still in the catalog, else the catalog default. */
export function resolveCurrentModelId(models: Model[], prefs: Prefs | null): string | undefined {
  const saved = prefs?.defaultModel;
  if (saved && models.some((m) => m.id === saved)) return saved;
  return models.find((m) => m.isDefault)?.id ?? models[0]?.id;
}

export function useCurrentModelId(): string | undefined {
  const models = useModelsStore((s) => s.models);
  const prefs = usePrefsStore((s) => s.prefs);
  return resolveCurrentModelId(models, prefs);
}
