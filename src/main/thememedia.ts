import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { dialog, protocol, type BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { THEMES } from '../shared/themes'
import { themesDir } from './paths'

const SCHEME = 'wptheme'
const EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']
const CONTENT_TYPE: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif'
}

const DESTINATION_IDS = new Set(THEMES.filter((t) => t.group === 'destination').map((t) => t.id))

/** Must run before app 'ready' so the scheme is treated as a secure, CSP-listable source. */
export function registerThemeScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])
}

/**
 * Serves the user's per-theme wallpapers from the themes folder over wptheme://theme/<id>, and copies chosen
 * images into that folder. Nothing here is bundled or distributed; the files live only on this PC.
 */
export class ThemeMedia {
  /** themeId -> file mtime in ms; a present entry means a custom wallpaper exists. Used to bust the CSS cache. */
  private media: Record<string, number> = {}

  async init(): Promise<void> {
    await mkdir(themesDir(), { recursive: true }).catch(() => undefined)
    await this.refresh()
    protocol.handle(SCHEME, (req) => this.serve(req))
  }

  snapshot(): Record<string, number> {
    return { ...this.media }
  }

  private async refresh(): Promise<void> {
    const next: Record<string, number> = {}
    let entries: string[] = []
    try {
      entries = await readdir(themesDir())
    } catch {
      entries = []
    }
    for (const name of entries) {
      const ext = extname(name).toLowerCase()
      const id = name.slice(0, -ext.length)
      if (!DESTINATION_IDS.has(id as never) || !EXTENSIONS.includes(ext)) continue
      try {
        next[id] = Math.floor((await stat(join(themesDir(), name))).mtimeMs)
      } catch {
        // Skip unreadable files.
      }
    }
    this.media = next
  }

  private async fileFor(id: string): Promise<string | null> {
    for (const ext of EXTENSIONS) {
      const path = join(themesDir(), `${id}${ext}`)
      try {
        await stat(path)
        return path
      } catch {
        // Try the next extension.
      }
    }
    return null
  }

  private async serve(req: Request): Promise<Response> {
    const id = new URL(req.url).pathname.replace(/^\/+/, '')
    if (!DESTINATION_IDS.has(id as never)) return new Response('not found', { status: 404 })
    const path = await this.fileFor(id)
    if (!path) return new Response('not found', { status: 404 })
    const type = CONTENT_TYPE[extname(path).toLowerCase()] ?? 'application/octet-stream'
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream
    return new Response(stream, { headers: { 'Content-Type': type, 'Cache-Control': 'no-cache' } })
  }

  /** Opens a picker and copies the chosen image in as this theme's wallpaper. Returns true if one was set. */
  async setFromDialog(win: BrowserWindow, id: string): Promise<boolean> {
    if (!DESTINATION_IDS.has(id as never)) return false
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a background image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'] }]
    })
    if (result.canceled || !result.filePaths[0]) return false
    const source = result.filePaths[0]
    const ext = extname(source).toLowerCase()
    if (!EXTENSIONS.includes(ext)) return false
    await mkdir(themesDir(), { recursive: true })
    await this.removeFiles(id)
    await copyFile(source, join(themesDir(), `${id}${ext}`))
    await this.refresh()
    log.info(`[theme-media] set wallpaper for ${id}`)
    return true
  }

  async clear(id: string): Promise<void> {
    await this.removeFiles(id)
    await this.refresh()
  }

  private async removeFiles(id: string): Promise<void> {
    for (const ext of EXTENSIONS) await rm(join(themesDir(), `${id}${ext}`), { force: true }).catch(() => undefined)
  }
}
