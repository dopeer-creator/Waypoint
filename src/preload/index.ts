import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
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

// Not IPC: only the preload can turn a dropped File into a path, since Electron removed File.path.
api.pathForFile = (file: File) => webUtils.getPathForFile(file)

contextBridge.exposeInMainWorld('waypoint', api as unknown as WaypointApi)
