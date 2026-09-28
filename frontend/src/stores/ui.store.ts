import { create } from 'zustand';

export interface UiState {
  rightPanelCollapsed: boolean;
  activeArtifactTab: string;
  showThinkingOverride: boolean | null;
  readSeqMap: Record<string, number>;

  setRightPanelCollapsed: (collapsed: boolean) => void;
  toggleRightPanel: () => void;
  setActiveArtifactTab: (tab: string) => void;
  setShowThinkingOverride: (override: boolean | null) => void;
  markSessionAsRead: (sessionId: string, seq: number) => void;
  getReadSeq: (sessionId: string) => number;
}

const STORAGE_KEY_RIGHT_PANEL = 'agy-studio-ui-right-collapsed';

function getStoredRightPanelCollapsed(): boolean {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const val = window.localStorage.getItem(STORAGE_KEY_RIGHT_PANEL);
      if (val !== null) {
        return val === 'true';
      }
    } catch {
      // ignore
    }
  }
  return false;
}

export const useUiStore = create<UiState>()((set, get) => ({
  rightPanelCollapsed: getStoredRightPanelCollapsed(),
  activeArtifactTab: 'Task',
  showThinkingOverride: null,
  readSeqMap: {},

  setRightPanelCollapsed: (collapsed: boolean) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(STORAGE_KEY_RIGHT_PANEL, String(collapsed));
      } catch {
        // ignore
      }
    }
    set({ rightPanelCollapsed: collapsed });
  },

  toggleRightPanel: () => {
    const next = !get().rightPanelCollapsed;
    get().setRightPanelCollapsed(next);
  },

  setActiveArtifactTab: (tab: string) => {
    set({ activeArtifactTab: tab });
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
