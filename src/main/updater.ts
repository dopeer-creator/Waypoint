import { app } from 'electron'
import log from 'electron-log/main'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/types'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * GitHub Releases auto-update. Updates download in the background and install silently when the app quits,
 * so a running batch is never cut off; the UI can also offer "Restart now".
 */
export class Updater {
  state: UpdateState = { state: 'idle' }

  constructor(private readonly onState: (state: UpdateState) => void) {}

  init(): void {
    if (!app.isPackaged) return
    autoUpdater.logger = log
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'none', version: app.getVersion() }))
    autoUpdater.on('update-available', (info) => this.set({ state: 'available', version: info.version }))
    autoUpdater.on('download-progress', (p) => {
      const version = 'version' in this.state ? this.state.version : ''
      this.set({ state: 'downloading', version, percent: Math.round(p.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version }))
    autoUpdater.on('error', (err) => this.fail(err))

    void this.check()
    setInterval(() => void this.check(), CHECK_INTERVAL_MS)
  }

  async check(): Promise<void> {
    if (!app.isPackaged) {
      this.set({ state: 'none', version: app.getVersion() })
      return
    }
    if (this.state.state === 'downloading' || this.state.state === 'ready') return
    await autoUpdater.checkForUpdates().catch((err: Error) => this.fail(err))
  }

  private fail(err: Error): void {
    // A repo with no releases yet isn't a failure — there's just nothing newer.
    if (/no published versions/i.test(err.message)) this.set({ state: 'none', version: app.getVersion() })
    else this.set({ state: 'error', message: err.message.split('\n')[0] })
  }

  install(): void {
    if (this.state.state === 'ready') autoUpdater.quitAndInstall(true, true)
  }

  private set(state: UpdateState): void {
    this.state = state
    this.onState(state)
  }
}
