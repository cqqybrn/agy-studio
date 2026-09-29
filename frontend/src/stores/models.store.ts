import { create } from 'zustand';
import type { Model, Prefs } from '@agy-studio/contracts';
import { getModels } from '../api/endpoints';
import { usePrefsStore } from './prefs.store';

export interface ModelsState {
  models: Model[];
  loading: boolean;
  error: string | null;

  fetchModels: (refresh?: boolean) => Promise<Model[]>;
}

export const useModelsStore = create<ModelsState>()((set) => ({
  models: [],
  loading: false,
  error: null,

  fetchModels: async (refresh?: boolean) => {
    set({ loading: true, error: null });
    try {
      const models = await getModels(refresh ? { refresh: true } : undefined);
      set({ models, loading: false });
      return models;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: msg });
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
