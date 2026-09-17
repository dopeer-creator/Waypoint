import { cp, readFile, stat, statfs } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray
} from 'electron'
import log from 'electron-log/main'
import { invokeMethods, type InvokeApi } from '../shared/api'
import { CAPTURE_PORTS } from '../shared/extension'
import { hrefsFromHtml } from '../shared/links'
import type { AddLinksResult, AppSnapshot, ClipboardOffer, Toast } from '../shared/types'
import { Aria2 } from './aria2'
import { installedHandoffBrowsers } from './browsers'
import { CaptureServer } from './capture'
import { Store } from './db'
import { DownloadManager } from './downloads'
import { findWinRAR } from './extract'
import { extractUrls, hostOf, looksLikeDownload } from './links'
import { aria2Path, dbPath, extensionInstallDir, extensionSourceDir, iconPath, themesDir } from './paths'
import { installedBrowsers, Resolver } from './resolver/resolver'
import { SettingsService } from './settings'
import { registerThemeScheme, ThemeMedia } from './thememedia'
import { Updater } from './updater'

log.initialize()
log.transports.file.level = 'info'

// Must run before app 'ready'.
registerThemeScheme()

// Dev runs use plain electron.exe; a separate ID stops Windows caching its atom icon for the installed app.
const APP_ID = app.isPackaged ? 'com.dopeercreator.waypoint' : 'com.dopeercreator.waypoint.dev'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId(APP_ID)
  app.on('second-instance', showWindow)
  app.whenReady().then(main)
}

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let cleanedUp = false
/** Set once services exist, so a second launch during startup doesn't try to build a window early. */
let ready = false

let store: Store
let settings: SettingsService
let resolver: Resolver
let downloads: DownloadManager
let updater: Updater
let capture: CaptureServer
const themeMedia = new ThemeMedia()

/** Shows the main window, recreating it if it was closed (tray click or launching Waypoint again). */
function showWindow(): void {
  if (!ready) return
  if (!win || win.isDestroyed()) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Sends to the renderer only while the window is alive. */
function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function toast(kind: Toast['kind'], text: string): void {
  send('wp:toast', { kind, text } satisfies Toast)
}

function snapshot(): AppSnapshot {
  const links = store.listLinks().map(({ headers: _headers, ...link }) => ({ ...link, speed: downloads.speedOf(link.id) }))
  const inBatch = links.filter((l) => l.batchId !== null)
  return {
    links,
    batches: store.listBatches(),
    resolver: resolver.state,
    extensionConnected: capture.connected,
    themeMedia: themeMedia.snapshot(),
    stats: {
      speed: inBatch.reduce((sum, l) => sum + l.speed, 0),
      active: inBatch.filter((l) => l.dlStatus === 'active').length,
      queued: inBatch.filter((l) => l.dlStatus === 'queued').length,
      total: inBatch.length
    }
  }
}

let pushTimer: NodeJS.Timeout | null = null
function pushSnapshot(): void {
  if (pushTimer || !win || win.isDestroyed()) return
  pushTimer = setTimeout(() => {
    pushTimer = null
    if (!win || win.isDestroyed()) return
    const snap = snapshot()
    win.webContents.send('wp:snapshot', snap)
    updateTaskbarProgress(win, snap)
  }, 150)
}

function updateTaskbarProgress(target: BrowserWindow, snap: AppSnapshot): void {
  const running = new Set(snap.batches.filter((b) => b.status === 'downloading').map((b) => b.id))
  const links = snap.links.filter((l) => l.batchId !== null && running.has(l.batchId))
  const total = links.reduce((sum, l) => sum + l.totalBytes, 0)
  const done = links.reduce((sum, l) => sum + l.doneBytes, 0)
  target.setProgressBar(links.length && total > 0 ? done / total : -1)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    title: 'Waypoint',
    icon: iconPath('icon.ico'),
    backgroundColor: '#0B0F14',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0B0F14', symbolColor: '#94A3B8', height: 44 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  const current = win
  current.once('ready-to-show', () => current.show())
  current.on('focus', () => current.flashFrame(false))
  current.on('closed', () => {
    if (win === current) win = null
  })
  // Point the taskbar at Waypoint.exe's own icon so Windows can't show a stale cached one.
  if (app.isPackaged) {
    current.setAppDetails({
      appId: APP_ID,
      appIconPath: process.execPath,
      appIconIndex: 0,
      relaunchCommand: `"${process.execPath}"`,
      relaunchDisplayName: 'Waypoint'
    })
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  win.on('close', (event) => {
    if (quitting || !win) return
    if (settings.get().closeToTray) {
      event.preventDefault()
      win.hide()
      return
    }
    const snap = snapshot()
    const busy = snap.stats.active + snap.stats.queued > 0 || resolver.state.running
    if (!busy) return
    event.preventDefault()
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      title: 'Waypoint',
      message: 'Downloads are still running.',
      detail: 'Minimize to the tray to keep downloading. If you quit, downloads resume the next time you open Waypoint.',
      buttons: ['Minimize to tray', 'Quit', 'Cancel'],
      defaultId: 0,
      cancelId: 2
    })
    if (choice === 0) win.hide()
    if (choice === 1) {
      quitting = true
      app.quit()
    }
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && rendererUrl) void win.loadURL(rendererUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(iconPath('icon.ico')))
  tray.setToolTip('Waypoint')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Waypoint', click: showWindow },
      { type: 'separator' },
      { label: 'Pause all downloads', click: () => void downloads.pauseAll().then(pushSnapshot) },
      { label: 'Resume all downloads', click: () => void downloads.resumeAll().then(pushSnapshot) },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', showWindow)
}

/** Clipboard text plus the targets of any links in copied rich text, where URLs hide behind link text. */
async function readClipboardLinks(): Promise<string> {
  const [text, items] = await Promise.all([clipboard.readText(), clipboard.read().catch(() => [])])
  const htmlItem = items.find((item) => item.types.includes('text/html'))
  const html = htmlItem ? await ((await htmlItem.getType('text/html')) as Blob).text().catch(() => '') : ''
  return [text, ...hrefsFromHtml(html)].join('\n')
}

/** How often the clipboard is read. */
const CLIPBOARD_POLL_MS = 700
/** How long the clipboard has to sit still before we offer, so a burst of copies becomes one prompt. */
const CLIPBOARD_SETTLE_MS = 1500
/** A prompt nobody ever answered (a reloaded window, say) stops blocking new offers after this. */
const CLIPBOARD_PROMPT_STALE_MS = 10 * 60_000

/** Links offered but turned down this session, so the same copy doesn't get asked about twice. */
const dismissedLinks = new Set<string>()
/** When the open offer was sent, or 0 when no prompt is on screen. */
let clipboardPromptAt = 0

/**
 * JDownloader-style clipboard capture: when new links are copied, ask the user before adding them rather than
 * grabbing silently. The renderer shows the prompt and calls addLinks on a yes, then answers with
 * clipboardAnswer either way.
 *
 * The clipboard sees everything the user copies all day, so an offer needs a positive reason: the link has to
 * look like a file (see looksLikeDownload), be new, not have been turned down already, and not belong to a host
 * they have muted. Copies are then pooled until the copying stops, so grabbing five links one after another
 * asks once.
 */
async function watchClipboard(): Promise<void> {
  // Ignore whatever is already on the clipboard when watching starts.
  let last = await readClipboardLinks()
  let pending: string[] = []
  let pendingAt = 0

  settings.onChange((next, prev) => {
    if (next.clipboardWatch && !prev.clipboardWatch) void readClipboardLinks().then((text) => (last = text))
  })

  setInterval(async () => {
    if (!settings.get().clipboardWatch) {
      pending = []
      return
    }

    const text = await readClipboardLinks()
    if (text !== last) {
      last = text
      const listed = store.listLinks()
      const existing = new Set(listed.map((l) => l.url))
      // A host the user has added links from before is one they download from, whether or not we ship its name.
      const familiar = new Set(listed.map((l) => hostOf(l.url)).filter(Boolean))
      const muted = new Set(settings.get().clipboardIgnoreHosts)
      for (const url of extractUrls(text).urls) {
        if (existing.has(url) || dismissedLinks.has(url) || pending.includes(url)) continue
        if (muted.has(hostOf(url)) || !looksLikeDownload(url, familiar)) continue
        pending.push(url)
      }
      if (pending.length) pendingAt = Date.now()
    }

    if (!pending.length || Date.now() - pendingAt < CLIPBOARD_SETTLE_MS) return
    if (clipboardPromptAt && Date.now() - clipboardPromptAt < CLIPBOARD_PROMPT_STALE_MS) return // already asking

    const fresh = pending
    pending = []
    clipboardPromptAt = Date.now()
    const hosts = [...new Set(fresh.map(hostOf))].filter(Boolean)
    send('wp:clipboard-offer', { text: fresh.join('\n'), count: fresh.length, hosts } satisfies ClipboardOffer)
  }, CLIPBOARD_POLL_MS)
}

/** Bytes. A link list is text; anything much larger was dropped by mistake and isn't worth reading into memory. */
const MAX_IMPORT_BYTES = 8 * 1024 * 1024

/** Reads link lists off disk, for both the Import button and files dropped on the window. */
async function importFromPaths(paths: string[]): Promise<AddLinksResult | null> {
  if (!paths.length) return null

  const texts: string[] = []
  for (const path of paths) {
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) continue // a dropped folder, or something that vanished
    if (info.size > MAX_IMPORT_BYTES) {
      log.info(`[import] skipped ${basename(path)}: ${info.size} bytes is too large for a link list`)
      continue
    }
    texts.push(await readFile(path, 'utf8').catch(() => ''))
  }
  if (!texts.length) return { added: 0, duplicates: 0, invalid: 0 }

  const raw = texts.join('\n')
  // Same two passes as a paste: plain URLs in the text, plus the hrefs behind link text in saved HTML.
  const { urls, invalid } = extractUrls([raw, ...hrefsFromHtml(raw)].join('\n'))
  const { added, duplicates } = store.insertLinks(urls)
  pushSnapshot()
  return { added, duplicates, invalid }
}

function registerIpc(): void {
  const handlers: InvokeApi = {
    getSnapshot: async () => snapshot(),
    getSettings: async () => settings.get(),
    setSettings: async (patch) => {
      const next = settings.update(patch)
      pushSnapshot()
      return next
    },
    resetSettings: async () => {
      // Resolve mode, browser and concurrency all change under a run's feet; make the user stop it first.
      if (resolver.state.running) throw new Error('Stop resolving before resetting settings')
      const next = settings.reset()
      log.info('[settings] reset to defaults')
      pushSnapshot()
      return next
    },
    getEnvironment: async () => ({
      version: app.getVersion(),
      winrarPath: await findWinRAR(settings.get().winrarPath),
      aria2Ready: downloads.aria2.ready,
      aria2Version: downloads.aria2.version,
      browsers: installedBrowsers(),
      handoffBrowsers: installedHandoffBrowsers(),
      extensionFolder: extensionInstallDir(),
      extensionVersion: capture.extensionVersion,
      userDataDir: app.getPath('userData')
    }),

    addLinks: async (text) => {
      const { urls, invalid } = extractUrls(text)
      const { added, duplicates } = store.insertLinks(urls)
      pushSnapshot()
      return { added, duplicates, invalid }
    },
    importLinks: async () => {
      const result = await dialog.showOpenDialog(win!, {
        title: 'Import links from a file',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Link lists', extensions: ['txt', 'text', 'csv', 'md', 'html', 'htm'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      if (result.canceled || !result.filePaths.length) return null
      return importFromPaths(result.filePaths)
    },
    importLinksFrom: async (paths: string[]) => importFromPaths(paths),
    removeLinks: async (ids) => {
      const removable = ids.filter((id) => id !== resolver.state.currentLinkId)
      const batchIds = new Set(removable.map((id) => store.getLink(id)?.batchId).filter((b): b is number => b != null))
      await downloads.dropLinks(removable)
      store.deleteLinks(removable)
      for (const batchId of batchIds) if (!store.linksInBatch(batchId).length) store.deleteBatch(batchId)
      pushSnapshot()
    },
    retryLinks: async (ids) => {
      const grabber = ids.filter((id) => store.getLink(id)?.batchId === null)
      store.updateLinks(grabber, { status: 'pending', error: null, resolveAttempts: 0 })
      const inBatch = ids.filter((id) => !grabber.includes(id))
      if (inBatch.length) await downloads.resumeLinks(inBatch)
      pushSnapshot()
    },

    resolverStart: async () => {
      void resolver.start()
    },
    resolverStop: async () => resolver.stop(),
    resolverSkip: async () => resolver.skip(),

    clipboardAnswer: async ({ text, added, ignoreHosts }) => {
      clipboardPromptAt = 0
      const urls = extractUrls(text).urls
      // Added links are in the list now, which is what stops them being offered again.
      if (!added) for (const url of urls) dismissedLinks.add(url)
      if (!ignoreHosts) return
      const hosts = urls.map(hostOf).filter(Boolean)
      settings.update({ clipboardIgnoreHosts: [...settings.get().clipboardIgnoreHosts, ...hosts] })
      pushSnapshot()
    },

    pickFolder: async (defaultPath) => {
      const result = await dialog.showOpenDialog(win!, {
        title: 'Choose download folder',
        defaultPath: defaultPath || settings.get().baseFolder,
        properties: ['openDirectory', 'createDirectory']
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    diskSpace: async (path) => {
      try {
        const s = await statfs(path)
        return { free: s.bsize * s.bavail, total: s.bsize * s.blocks }
      } catch {
        return null
      }
    },
    createBatch: async (input) => {
      const batch = await downloads.createBatch(input)
      pushSnapshot()
      return batch
    },

    moveLink: async (id, delta) => downloads.moveLink(id, delta).then(pushSnapshot),
    pauseLinks: async (ids) => downloads.pauseLinks(ids).then(pushSnapshot),
    resumeLinks: async (ids) => downloads.resumeLinks(ids).then(pushSnapshot),
    pauseBatch: async (id) => downloads.pauseBatch(id).then(pushSnapshot),
    resumeBatch: async (id) => downloads.resumeBatch(id).then(pushSnapshot),
    removeBatch: async (id) => downloads.removeBatch(id).then(pushSnapshot),
    extractBatch: async (id) => {
      downloads.extract(id)
      pushSnapshot()
    },
    pauseAll: async () => downloads.pauseAll().then(pushSnapshot),
    resumeAll: async () => downloads.resumeAll().then(pushSnapshot),

    openPath: async (path) => {
      const error = await shell.openPath(path)
      if (error) toast('error', error)
    },
    showInFolder: async (path) => shell.showItemInFolder(path),
    openLogs: async () => {
      await shell.openPath(dirname(log.transports.file.getFile().path))
    },
    resetBrowserProfile: async () => resolver.resetProfile(),
    openExtensionFolder: async () => {
      await syncExtensionFolder()
      const error = await shell.openPath(extensionInstallDir())
      if (error) toast('error', error)
    },
    copyText: async (text) => {
      await clipboard.writeText(text)
    },
    setThemeBackground: async (themeId) => {
      const set = win ? await themeMedia.setFromDialog(win, themeId) : false
      if (set) pushSnapshot()
      return set
    },
    clearThemeBackground: async (themeId) => {
      await themeMedia.clear(themeId)
      pushSnapshot()
    },
    openThemesFolder: async () => {
      const error = await shell.openPath(themesDir())
      if (error) toast('error', error)
    },
    setTitleBar: async ({ color, symbolColor }) => {
      win?.setTitleBarOverlay({ color, symbolColor, height: 44 })
      win?.setBackgroundColor(color)
    },

    checkForUpdates: async () => updater.check(),
    installUpdate: async () => {
      await cleanup()
      updater.install()
    }
  }

  for (const method of invokeMethods) {
    const handler = handlers[method] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(`wp:${method}`, async (_event, ...args) => {
      try {
        return await handler(...args)
      } catch (err) {
        log.error(`[ipc] ${method} failed`, err)
        throw err
      }
    })
  }
}

/** Copies the bundled extension to a stable folder the user loads into their browser, refreshing it after app updates. */
async function syncExtensionFolder(): Promise<void> {
  try {
    await cp(extensionSourceDir(), extensionInstallDir(), { recursive: true, force: true })
  } catch (err) {
    log.warn('[extension] could not copy the extension folder', err)
  }
}

async function cleanup(): Promise<void> {
  if (cleanedUp) return
  cleanedUp = true
  resolver.stop()
  capture.stop()
  await downloads.shutdown().catch((err) => log.warn('aria2 shutdown failed', err))
  store.close()
}

async function main(): Promise<void> {
  store = new Store(dbPath())
  settings = new SettingsService(store)
  resolver = new Resolver(store, settings)
  downloads = new DownloadManager(store, settings, new Aria2(aria2Path()))
  updater = new Updater((state) => send('wp:update', state))

  // The browser extension offers downloads here; the resolver takes the one it's waiting on.
  capture = new CaptureServer(app.isPackaged ? CAPTURE_PORTS[0] : CAPTURE_PORTS[1])
  capture.decide = (download) => resolver.offerDownload(download)
  capture.on('status', () => pushSnapshot())
  resolver.extensionConnected = () => capture.connected

  // Main also changes settings (e.g. remembering the last batch folder); keep the UI in sync.
  settings.onChange((next) => send('wp:settings', next))

  resolver.on('state', (state) => {
    if (state.phase === 'waiting-user' && win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true)
    pushSnapshot()
  })
  resolver.on('resolved', (id: number) => void downloads.onLinkResolved(id).then(pushSnapshot))
  resolver.on('failed', (id: number) => {
    downloads.onLinkFailed(id)
    pushSnapshot()
  })
  resolver.on('finished', () => {
    // Links that expired while the run was ending still need a pass.
    if (store.countPending() > 0 && store.nextPendingLink()?.batchId != null) void resolver.start()
    pushSnapshot()
  })
  resolver.on('notice', (text: string) => toast('info', text))

  downloads.on('changed', pushSnapshot)
  downloads.on('notice', (text: string) => toast('info', text))
  downloads.on('needs-resolve', () => {
    if (!resolver.state.running) {
      toast('info', 'A download link expired — opening the browser to refresh it')
      void resolver.start()
    }
  })
  downloads.on('batch-done', (batch) => {
    const ok = batch.status === 'done'
    const body = ok ? `${batch.name} finished` : `${batch.name} finished with errors`
    toast(ok ? 'success' : 'error', body)
    if (Notification.isSupported()) new Notification({ title: 'Waypoint', body, icon: iconPath('icon.png') }).show()
  })

  // Any link left mid-resolve by a crash goes back to the queue.
  for (const link of store.listLinks()) if (link.status === 'resolving') store.updateLink(link.id, { status: 'pending' })

  app.on('before-quit', () => {
    quitting = true
  })
  app.on('will-quit', (event) => {
    if (cleanedUp) return
    event.preventDefault()
    void cleanup().finally(() => app.quit())
  })
  // Closing the window quits the whole app (downloads resume next launch). Close-to-tray and
  // "Minimize to tray" hide the window instead, so they never reach this.
  app.on('window-all-closed', () => {
    quitting = true
    app.quit()
  })

  registerIpc()
  capture.start()
  void themeMedia.init()
  void syncExtensionFolder()
  createWindow()
  ready = true
  createTray()
  void watchClipboard()
  updater.init()

  try {
    await downloads.init()
  } catch (err) {
    log.error('aria2 failed to start', err)
    dialog.showErrorBox('Waypoint', `The download engine (aria2c) failed to start:\n${(err as Error).message}`)
  }
  pushSnapshot()
}
