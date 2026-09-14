import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { eventChannels, invokeMethods, type WaypointApi } from '../shared/api'

const api: Record<string, unknown> = {}

for (const method of invokeMethods) {
  api[method] = (...args: unknown[]) => ipcRenderer.invoke(`wp:${method}`, ...args)
}

for (const [name, channel] of Object.entries(eventChannels)) {
  api[name] = (cb: (payload: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('waypoint', api as unknown as WaypointApi)
