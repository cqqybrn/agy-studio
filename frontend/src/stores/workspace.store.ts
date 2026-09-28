import { create } from 'zustand';
import type { CreateWorkspaceBody, Workspace } from '@agy-studio/contracts';
import {
  createWorkspace as apiCreateWorkspace,
  deleteWorkspace as apiDeleteWorkspace,
  getWorkspaces,
} from '../api/endpoints';

export interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  loading: boolean;
  error: string | null;

  fetchWorkspaces: () => Promise<Workspace[]>;
  selectWorkspace: (workspaceId: string | null) => void;
  setCurrentWorkspace: (workspace: Workspace | null) => void;
  createWorkspace: (body: CreateWorkspaceBody) => Promise<Workspace>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
}

const STORAGE_KEY_CURRENT_WORKSPACE = 'agy-studio-current-workspace-id';

function getStoredWorkspaceId(): string | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      return window.localStorage.getItem(STORAGE_KEY_CURRENT_WORKSPACE);
    } catch {
      // ignore
    }
  }
  return null;
}

function setStoredWorkspaceId(id: string | null): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (id) {
        window.localStorage.setItem(STORAGE_KEY_CURRENT_WORKSPACE, id);
      } else {
        window.localStorage.removeItem(STORAGE_KEY_CURRENT_WORKSPACE);
      }
    } catch {
      // ignore
    }
  }
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  workspaces: [],
  currentWorkspace: null,
  loading: false,
  error: null,

  fetchWorkspaces: async () => {
    set({ loading: true, error: null });
    try {
      const workspaces = await getWorkspaces();
      const current = get().currentWorkspace;
      const storedId = getStoredWorkspaceId();

      let nextCurrent: Workspace | null = null;
      if (current && workspaces.some((w) => w.id === current.id)) {
        nextCurrent = workspaces.find((w) => w.id === current.id) ?? current;
      } else if (storedId && workspaces.some((w) => w.id === storedId)) {
        nextCurrent = workspaces.find((w) => w.id === storedId) ?? null;
      } else if (workspaces.length > 0) {
        nextCurrent = workspaces[0];
      }

      setStoredWorkspaceId(nextCurrent?.id ?? null);
      set({ workspaces, currentWorkspace: nextCurrent, loading: false });
      return workspaces;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: msg });
      return [];
    }
  },

  selectWorkspace: (workspaceId: string | null) => {
    if (!workspaceId) {
      setStoredWorkspaceId(null);
      set({ currentWorkspace: null });
      return;
    }
    const found = get().workspaces.find((w) => w.id === workspaceId) ?? null;
    setStoredWorkspaceId(found?.id ?? null);
    set({ currentWorkspace: found });
  },

  setCurrentWorkspace: (workspace: Workspace | null) => {
    setStoredWorkspaceId(workspace?.id ?? null);
    set({ currentWorkspace: workspace });
  },

  createWorkspace: async (body: CreateWorkspaceBody) => {
    set({ loading: true, error: null });
    try {
      const created = await apiCreateWorkspace(body);
      const workspaces = [...get().workspaces, created];
      setStoredWorkspaceId(created.id);
      set({
        workspaces,
        currentWorkspace: created,
        loading: false,
      });
      return created;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: msg });
      throw err;
    }
  },

  deleteWorkspace: async (workspaceId: string) => {
    set({ loading: true, error: null });
    try {
      await apiDeleteWorkspace(workspaceId);
      const nextWorkspaces = get().workspaces.filter((w) => w.id !== workspaceId);
      let nextCurrent = get().currentWorkspace;
      if (nextCurrent?.id === workspaceId) {
        nextCurrent = nextWorkspaces[0] ?? null;
      }
      setStoredWorkspaceId(nextCurrent?.id ?? null);
      set({
        workspaces: nextWorkspaces,
        currentWorkspace: nextCurrent,
        loading: false,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: msg });
      throw err;
    }
  },
}));
