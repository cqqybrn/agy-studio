import { create } from 'zustand';
import {
  applyTheme,
  readStoredThemePreference,
  storeThemePreference,
  type ThemePreference,
} from '../theme';

export interface UiState {
  showThinkingOverride: boolean | null;
  readSeqMap: Record<string, number>;
  /** UI-only preference kept in localStorage, not in the backend Prefs contract. */
  themePreference: ThemePreference;

  setThemePreference: (preference: ThemePreference) => void;
  setShowThinkingOverride: (override: boolean | null) => void;
  markSessionAsRead: (sessionId: string, seq: number) => void;
  getReadSeq: (sessionId: string) => number;
}

export const useUiStore = create<UiState>()((set, get) => ({
  showThinkingOverride: null,
  readSeqMap: {},
  themePreference: readStoredThemePreference(),

  setThemePreference: (preference: ThemePreference) => {
    storeThemePreference(preference);
    applyTheme(preference);
    set({ themePreference: preference });
  },

  setShowThinkingOverride: (override: boolean | null) => {
    set({ showThinkingOverride: override });
  },

  markSessionAsRead: (sessionId: string, seq: number) => {
    set((state) => {
      const current = state.readSeqMap[sessionId] ?? 0;
      if (seq <= current) {
        return state;
      }
      return {
        readSeqMap: {
          ...state.readSeqMap,
          [sessionId]: seq,
        },
      };
    });
  },

  getReadSeq: (sessionId: string) => {
    return get().readSeqMap[sessionId] ?? 0;
  },
}));
