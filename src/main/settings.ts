import { app } from 'electron'
import { THEME_IDS } from '../shared/themes'
import type { Settings } from '../shared/types'
import type { Store } from './db'

export function defaultSettings(): Settings {
  return {
    theme: 'system',
    baseFolder: app.getPath('downloads'),
    extractDefault: true,
    maxConcurrent: 4,
    connectionsPerFile: 8,
    speedLimitKib: 0,
    resolveMode: 'automated',
    handoffBrowser: 'brave',
    browserChannel: 'chrome',
    resolveTimeoutSec: 300,
    autoClickDownload: true,
    winrarPath: '',
    clipboardWatch: false,
    deleteArchivesAfterExtract: false,
    closeToTray: false,
    maxResolveAttempts: 3,
    sceneDim: 55
  }
}

const clamp = (n: unknown, min: number, max: number, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback

export class SettingsService {
  private current: Settings
  private listeners: ((next: Settings, prev: Settings) => void)[] = []

  constructor(private store: Store) {
    this.current = this.normalize({ ...defaultSettings(), ...store.readSettings() })
  }

  get(): Settings {
    return this.current
  }

  update(patch: Partial<Settings>): Settings {
    const prev = this.current
    this.current = this.normalize({ ...prev, ...patch })
    this.store.writeSettings(this.current)
    for (const l of this.listeners) l(this.current, prev)
    return this.current
  }

  onChange(listener: (next: Settings, prev: Settings) => void): void {
    this.listeners.push(listener)
  }

  private normalize(s: Settings): Settings {
    const d = defaultSettings()
    return {
      ...s,
      maxConcurrent: clamp(s.maxConcurrent, 1, 16, d.maxConcurrent),
      connectionsPerFile: clamp(s.connectionsPerFile, 1, 16, d.connectionsPerFile),
      speedLimitKib: clamp(s.speedLimitKib, 0, 10_000_000, 0),
      resolveTimeoutSec: clamp(s.resolveTimeoutSec, 30, 3600, d.resolveTimeoutSec),
      maxResolveAttempts: clamp(s.maxResolveAttempts, 1, 10, d.maxResolveAttempts),
      sceneDim: clamp(s.sceneDim, 0, 90, d.sceneDim),
      theme: THEME_IDS.includes(s.theme) ? s.theme : d.theme,
      browserChannel: s.browserChannel === 'msedge' ? 'msedge' : 'chrome',
      resolveMode: s.resolveMode === 'automated' ? 'automated' : 'handoff',
      handoffBrowser: ['brave', 'chrome', 'edge', 'default'].includes(s.handoffBrowser) ? s.handoffBrowser : d.handoffBrowser
    }
  }
}
