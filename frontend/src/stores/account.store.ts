import { create } from 'zustand';
import type { Account, SaveAccountBody, WhoAmI } from '@agy-studio/contracts';
import {
  deleteAccount as apiDeleteAccount,
  getAccounts,
  saveAccount as apiSaveAccount,
  switchAccount as apiSwitchAccount,
} from '../api/endpoints';
import { useQuotaStore } from './quota.store';

export interface AccountState {
  accounts: Account[];
  whoami: WhoAmI | null;
  loading: boolean;
  error: string | null;

  fetchAccounts: () => Promise<{ accounts: Account[]; whoami: WhoAmI } | null>;
  switchAccount: (name: string) => Promise<WhoAmI>;
  saveAccount: (body: SaveAccountBody) => Promise<Account>;
  deleteAccount: (name: string) => Promise<void>;
  handleAccountChanged: (whoami: WhoAmI) => void;
}

export const useAccountStore = create<AccountState>()((set, get) => ({
  accounts: [],
  whoami: null,
  loading: false,
  error: null,

  fetchAccounts: async () => {
    set({ loading: true, error: null });
    try {
      const data = await getAccounts();
      set({ accounts: data.accounts, whoami: data.whoami, loading: false });
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: msg });
      return null;
    }
  },

  switchAccount: async (name: string) => {
    set({ loading: true, error: null });
    try {
      const res = await apiSwitchAccount({ name });
      set({ whoami: res.whoami });
      // Refresh accounts list to reflect active flags and state
      await get().fetchAccounts();
      return res.whoami;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: msg });
      throw err;
    }
  },

  saveAccount: async (body: SaveAccountBody) => {
    set({ loading: true, error: null });
    try {
      const account = await apiSaveAccount(body);
      await get().fetchAccounts();
      return account;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: msg });
      throw err;
    }
  },

  deleteAccount: async (name: string) => {
    set({ loading: true, error: null });
    try {
      await apiDeleteAccount(name);
      await get().fetchAccounts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: msg });
      throw err;
    }
  },

  handleAccountChanged: (whoami: WhoAmI) => {
    set((state) => ({
      whoami,
      accounts: state.accounts.map((acc) => ({
        ...acc,
        active: whoami.activeProfile === acc.name,
      })),
    }));
    // Automatically trigger quota refresh on account change
    void useQuotaStore.getState().fetchQuota({ refresh: true });
  },
}));
