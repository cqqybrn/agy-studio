import { create } from 'zustand';
import {
  applyTheme,
  readStoredThemePreference,
  storeThemePreference,
  type ThemePreference,
} from '../theme';

/** Per-browser record of how far each session has been read (drives the unread dot). */
export const READ_SEQ_STORAGE_KEY = 'agy-studio-read-seq';

/** null when this browser has never stored a read record (first run). */
function readStoredReadSeqMap(): Record<string, number> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(READ_SEQ_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const map: Record<string, number> = {};
    for (const [id, seq] of Object.entries(parsed)) {
      if (typeof seq === 'number' && Number.isFinite(seq)) map[id] = seq;
    }
    return map;
  } catch {
    return null;
  }
}

function storeReadSeqMap(map: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(READ_SEQ_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable: read state lasts for this page only
  }
}

const storedReadSeqMap = readStoredReadSeqMap();

export interface UiState {
  showThinkingOverride: boolean | null;
  readSeqMap: Record<string, number>;
  /** False until a read record exists; the first session list then counts as already read. */
  readSeqSeeded: boolean;
  /** UI-only preference kept in localStorage, not in the backend Prefs contract. */
  themePreference: ThemePreference;

  setThemePreference: (preference: ThemePreference) => void;
  setShowThinkingOverride: (override: boolean | null) => void;
  markSessionAsRead: (sessionId: string, seq: number) => void;
  /** First run only: treat every existing session as read so old history shows no dots. */
  seedReadSeq: (sessions: ReadonlyArray<{ id: string; lastSeq: number }>) => void;
  getReadSeq: (sessionId: string) => number;
}

export const useUiStore = create<UiState>()((set, get) => ({
  showThinkingOverride: null,
  readSeqMap: storedReadSeqMap ?? {},
  readSeqSeeded: storedReadSeqMap !== null,
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
      const readSeqMap = {
        ...state.readSeqMap,
        [sessionId]: seq,
      };
      storeReadSeqMap(readSeqMap);
      return { readSeqMap, readSeqSeeded: true };
    });
  },

  seedReadSeq: (sessions) => {
    if (get().readSeqSeeded) return;
    const readSeqMap = { ...get().readSeqMap };
    for (const session of sessions) {
      readSeqMap[session.id] = Math.max(readSeqMap[session.id] ?? 0, session.lastSeq);
    }
    storeReadSeqMap(readSeqMap);
    set({ readSeqMap, readSeqSeeded: true });
  },

  getReadSeq: (sessionId: string) => {
    return get().readSeqMap[sessionId] ?? 0;
  },
}));
