// Preload: exposes a strictly-typed window.api (contextIsolated, no node access).
// Renderer usage: const res = await window.api.invoke('sessions:check-in', {...});
import { contextBridge, ipcRenderer } from 'electron';
import type { ApiMap, IpcChannel } from '../shared/types';

const parkingApi = {
  invoke<K extends IpcChannel>(channel: K, input: ApiMap[K]['input']): Promise<ApiMap[K]['output']> {
    return ipcRenderer.invoke(channel, input) as Promise<ApiMap[K]['output']>;
  },
};

export type ParkingApi = typeof parkingApi;

contextBridge.exposeInMainWorld('api', parkingApi);

declare global {
  interface Window {
    api: ParkingApi;
  }
}
