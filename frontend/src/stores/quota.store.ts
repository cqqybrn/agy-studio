import { create } from 'zustand';
import type { QuotaSnapshot } from '@agy-studio/contracts';
import { getQuota } from '../api/endpoints';

export interface QuotaState {
  quota: QuotaSnapshot | null;
  loading: boolean;
  error: string | null;

  fetchQuota: (query?: { account?: string; refresh?: boolean }) => Promise<QuotaSnapshot | null>;
  setQuota: (snapshot: QuotaSnapshot) => void;
  refreshQuota: (account?: string) => Promise<QuotaSnapshot | null>;
}

export const useQuotaStore = create<QuotaState>()((set, get) => ({
  quota: null,
  loading: false,
  error: null,

  fetchQuota: async (query?: { account?: string; refresh?: boolean }) => {
    set({ loading: true, error: null });
    try {
      const quota = await getQuota(query);
      set({ quota, loading: false });
      return quota;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: msg });
      return null;
    }
  },

  setQuota: (snapshot: QuotaSnapshot) => {
    set({ quota: snapshot, error: null });
  },

  refreshQuota: async (account?: string) => {
    return get().fetchQuota({ account, refresh: true });
  },
}));
