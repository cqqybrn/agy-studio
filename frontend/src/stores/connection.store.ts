import { create } from 'zustand';
import { wsClient, type WsStatus } from '../api/ws';

export interface ConnectionState {
  status: WsStatus;
  setStatus: (status: WsStatus) => void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  status: typeof wsClient !== 'undefined' ? wsClient.getStatus() : 'closed',
  setStatus: (status: WsStatus) => set({ status }),
}));
