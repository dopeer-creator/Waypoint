import { app } from 'electron'
import { join } from 'node:path'

/** Bundled resources (aria2c, icons). Packaged: <install>/resources. Dev: <repo>/resources. */
export function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}

export const aria2Path = (): string => join(resourcesDir(), 'bin', 'aria2c.exe')
export const iconPath = (name: 'icon.png' | 'icon.ico'): string => join(resourcesDir(), 'icons', name)

export const dbPath = (): string => join(app.getPath('userData'), 'waypoint.db')
export const browserProfileDir = (channel: string): string => join(app.getPath('userData'), 'browser-profile', channel)
