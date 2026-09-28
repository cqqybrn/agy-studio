import { create } from 'zustand';
import type { Prefs, UpdatePrefsBody } from '@agy-studio/contracts';
import { getPrefs, updatePrefs as apiUpdatePrefs } from '../api/endpoints';

export interface PrefsState {
  prefs: Prefs | null;
  loading: boolean;
  error: string | null;

  fetchPrefs: () => Promise<Prefs | null>;
  updatePrefs: (patch: UpdatePrefsBody) => Promise<Prefs>;
  setPrefs: (prefs: Prefs) => void;
}

export const usePrefsStore = create<PrefsState>()((set) => ({
  prefs: null,
  loading: false,
  error: null,

  fetchPrefs: async () => {
    set({ loading: true, error: null });
    try {
      const prefs = await getPrefs();
      set({ prefs, loading: false });
      return prefs;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: msg });
      return null;
    }
  },

  updatePrefs: async (patch: UpdatePrefsBody) => {
    set({ loading: true, error: null });
    try {
      const updated = await apiUpdatePrefs(patch);
      set({ prefs: updated, loading: false });
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: msg });
      throw err;
    }
  },

  setPrefs: (prefs: Prefs) => {
    set({ prefs });
  },
}));
