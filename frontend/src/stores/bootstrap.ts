import { wsClient } from '../api/ws';
import { useAccountStore } from './account.store';
import { useConnectionStore } from './connection.store';
import { useModelsStore } from './models.store';
import { usePrefsStore } from './prefs.store';
import { useQuotaStore } from './quota.store';
import { useSessionStore } from './session.store';
import { useWorkspaceStore } from './workspace.store';

export interface BootstrapOptions {
  connectWs?: boolean;
  autoFetch?: boolean;
}

export function initializeApp(options: BootstrapOptions = {}): () => void {
  // 1. Initial connection status mirror
  useConnectionStore.getState().setStatus(wsClient.getStatus());

  // 2. Mirror connection status changes
  const unsubStatus = wsClient.onStatusChange((status) => {
    useConnectionStore.getState().setStatus(status);
  });

  // 3. Dispatch global WS events to corresponding stores
  const unsubGlobal = wsClient.onGlobalEvent((event) => {
    switch (event.type) {
      case 'session.upserted':
        useSessionStore.getState().handleSessionUpserted(event.session);
        break;
      case 'session.deleted':
        useSessionStore.getState().handleSessionDeleted(event.sessionId);
        break;
      case 'run.status':
        useSessionStore.getState().handleRunStatus(event.run);
        break;
      case 'account.changed':
        useAccountStore.getState().handleAccountChanged(event.whoami);
        break;
      case 'quota.updated':
        useQuotaStore.getState().setQuota(event.snapshot);
        break;
      default:
        break;
    }
  });

  // 4. Optionally connect WebSocket
  if (options.connectWs !== false) {
    wsClient.connect();
  }

  // 5. Optionally load initial data
  if (options.autoFetch) {
    void useWorkspaceStore.getState().fetchWorkspaces();
    void useSessionStore.getState().fetchSessions();
    void usePrefsStore.getState().fetchPrefs();
    void useModelsStore.getState().fetchModels();
    void useAccountStore.getState().fetchAccounts();
    void useQuotaStore.getState().fetchQuota();
  }

  // Return teardown function
  return () => {
    unsubStatus();
    unsubGlobal();
  };
}
