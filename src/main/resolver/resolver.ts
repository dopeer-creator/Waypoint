import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import log from 'electron-log/main'
import { chromium, type BrowserContext, type Download, type Page } from 'playwright-core'
import type { BrowserChannel, ResolverState } from '../../shared/types'
import type { LinkRecord, Store } from '../db'
import { hostOf, sanitizeSegment } from '../links'
import { browserProfileDir } from '../paths'
import type { SettingsService } from '../settings'
import type { HostAdapter } from './adapter'
import { adapterFor } from './adapters'

/** How long to let Turnstile self-solve before asking the user to click it. */
const SELF_SOLVE_GRACE_MS = 6000
const POLL_MS = 700
const MAX_AUTO_CLICKS = 4
const CLICK_COOLDOWN_MS = 4000
/** After verification, how long auto-click gets (hosts often show a countdown) before asking the user to click. */
const CLICK_PROMPT_DELAY_MS = 8000

type StopReason = 'stop' | 'skip' | 'browser-closed'

class ResolveAborted extends Error {
  constructor(readonly reason: StopReason) {
    super(reason)
  }
}

interface Captured {
  url: string
  filename: string
}

function deferred<T>() {
  let settled = false
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = (v) => {
      if (!settled) {
        settled = true
        res(v)
      }
    }
    reject = (e) => {
      if (!settled) {
        settled = true
        rej(e)
      }
    }
  })
  return {
    promise,
    resolve,
    reject,
    get settled() {
      return settled
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const IDLE: ResolverState = { running: false, phase: 'idle', current: 0, total: 0, currentLinkId: null, message: null }

export function installedBrowsers(): BrowserChannel[] {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[]
  const found: BrowserChannel[] = []
  if (roots.some((r) => existsSync(join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')))) found.push('chrome')
  if (roots.some((r) => existsSync(join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')))) found.push('msedge')
  return found
}

/**
 * Walks pending links one at a time in a single real-browser tab: loads the page, waits for Cloudflare
 * Turnstile (self-solve or user click), triggers the host's download, and captures the final file URL plus
 * the cookies needed to fetch it outside the browser.
 *
 * Events: 'state' (ResolverState), 'resolved' (linkId), 'failed' (linkId), 'finished', 'notice' (string).
 */
export class Resolver extends EventEmitter {
  state: ResolverState = IDLE
  private context: BrowserContext | null = null
  private userAgent = ''
  private abort: AbortController | null = null
  private stopRequested = false

  constructor(
    private readonly store: Store,
    private readonly settings: SettingsService
  ) {
    super()
  }

  async start(): Promise<void> {
    if (this.state.running || this.store.countPending() === 0) return
    this.stopRequested = false
    this.setState({ ...IDLE, running: true, phase: 'launching', total: this.store.countPending(), message: 'Opening browser…' })

    let position = 0
    try {
      while (!this.stopRequested) {
        const link = this.store.nextPendingLink()
        if (!link) break
        position++
        this.setState({
          current: position,
          total: position + this.store.countPending() - 1,
          currentLinkId: link.id,
          phase: 'loading',
          message: `Opening ${link.host}`
        })
        await this.resolveOne(link)
      }
    } catch (err) {
      log.error('[resolver] run failed', err)
      this.emit('notice', `Resolver stopped: ${(err as Error).message}`)
    } finally {
      await this.closeContext()
      this.setState(IDLE)
      this.emit('finished')
    }
  }

  stop(): void {
    this.stopRequested = true
    this.abort?.abort('stop')
  }

  skip(): void {
    this.abort?.abort('skip')
  }

  async resetProfile(): Promise<void> {
    if (this.state.running) throw new Error('Stop resolving before resetting the browser profile')
    await rm(browserProfileDir(this.settings.get().browserChannel), { recursive: true, force: true })
  }

  private setState(patch: Partial<ResolverState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  private async resolveOne(link: LinkRecord): Promise<void> {
    this.store.updateLink(link.id, { status: 'resolving', error: null })
    this.emit('state', this.state)
    this.abort = new AbortController()
    const attempts = link.resolveAttempts + 1

    try {
      const context = await this.ensureContext()
      const adapter = adapterFor(link.url)
      const captured = await this.capture(context, link, adapter, this.abort.signal)
      const headers = await this.requestHeaders(context, captured.url)
      this.store.updateLink(link.id, {
        status: 'resolved',
        directUrl: captured.url,
        headers,
        filename: sanitizeSegment(captured.filename, `download-${link.id}`),
        resolveAttempts: attempts,
        error: null
      })
      log.info(`[resolver] resolved ${link.url} -> ${hostOf(captured.url)} (${captured.filename})`)
      this.emit('resolved', link.id)
    } catch (err) {
      const reason = err instanceof ResolveAborted ? err.reason : null
      if (reason === 'stop' || reason === 'browser-closed') {
        this.store.updateLink(link.id, { status: 'pending' })
        this.stopRequested = true
        if (reason === 'browser-closed') this.emit('notice', 'Browser window closed — resolving stopped')
      } else if (reason === 'skip') {
        this.store.updateLink(link.id, {
          status: 'skipped',
          error: 'Skipped',
          ...(link.batchId !== null ? { dlStatus: 'error' as const } : {})
        })
        this.emit('failed', link.id)
      } else {
        const message = (err as Error).message?.split('\n')[0] ?? String(err)
        log.warn(`[resolver] failed ${link.url}: ${message}`)
        this.store.updateLink(link.id, {
          status: 'failed',
          error: message,
          resolveAttempts: attempts,
          ...(link.batchId !== null ? { dlStatus: 'error' as const } : {})
        })
        this.emit('failed', link.id)
      }
    } finally {
      this.abort = null
    }
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context

    const preferred = this.settings.get().browserChannel
    const channels: BrowserChannel[] = [preferred, preferred === 'chrome' ? 'msedge' : 'chrome']
    let lastError: unknown
    for (const channel of channels) {
      try {
        this.setState({ phase: 'launching', message: `Opening ${channel === 'chrome' ? 'Chrome' : 'Edge'}…` })
        // Persistent profile: Turnstile trusts a browser with history and cookies far more than a fresh one.
        const context = await chromium.launchPersistentContext(browserProfileDir(channel), {
          channel,
          headless: false,
          acceptDownloads: true,
          viewport: null,
          args: ['--no-first-run', '--no-default-browser-check']
        })
        if (channel !== preferred) this.emit('notice', `Couldn't start ${preferred}; using ${channel} instead`)
        context.on('close', () => {
          if (this.context === context) {
            this.context = null
            this.abort?.abort('browser-closed')
          }
        })
        this.context = context
        const page = context.pages()[0] ?? (await context.newPage())
        this.userAgent = (await page.evaluate('navigator.userAgent')) as string
        return context
      } catch (err) {
        lastError = err
        log.warn(`[resolver] launch ${channel} failed`, err)
      }
    }
    throw new Error(`Could not start Chrome or Edge: ${(lastError as Error)?.message?.split('\n')[0]}`)
  }

  private async closeContext(): Promise<void> {
    const context = this.context
    this.context = null
    await context?.close().catch(() => undefined)
  }

  private async capture(context: BrowserContext, link: LinkRecord, adapter: HostAdapter, signal: AbortSignal): Promise<Captured> {
    // One tab at a time: open the new tab first (closing the last tab would close the window), then drop the rest.
    const page = await context.newPage()
    for (const other of context.pages()) if (other !== page) await other.close().catch(() => undefined)

    const result = deferred<Captured>()

    const onDownload = (download: Download) => {
      const url = download.url()
      const filename = download.suggestedFilename()
      download.cancel().catch(() => undefined)
      result.resolve({ url, filename })
    }
    const onPage = (popup: Page) => {
      popup.on('download', onDownload)
      this.closeAdPopup(popup, page)
    }
    const onAbort = () => result.reject(new ResolveAborted((signal.reason as StopReason) ?? 'stop'))
    const timeoutSec = this.settings.get().resolveTimeoutSec
    const timer = setTimeout(() => result.reject(new Error(`Timed out after ${timeoutSec}s`)), timeoutSec * 1000)

    page.on('download', onDownload)
    context.on('page', onPage)
    signal.addEventListener('abort', onAbort)
    if (signal.aborted) onAbort()

    page.goto(link.url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((err: Error) => {
      // Navigating straight to a file aborts the navigation but still fires a download; give that a moment to win.
      setTimeout(() => result.reject(new Error(`Could not open page: ${err.message.split('\n')[0]}`)), 2000)
    })
    void this.drive(page, adapter, () => result.settled, signal)

    try {
      return await result.promise
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      context.off('page', onPage)
      page.off('download', onDownload)
    }
  }

  /** Watches verification state and nudges the page toward a download until the capture settles. */
  private async drive(page: Page, adapter: HostAdapter, done: () => boolean, signal: AbortSignal): Promise<void> {
    const started = Date.now()
    let clicks = 0
    let lastClick = 0
    let askedToVerify = false
    let askedToClick = false
    let verifiedAt = 0

    while (!done() && !signal.aborted) {
      await sleep(POLL_MS)
      if (done() || signal.aborted || page.isClosed()) return

      let state
      try {
        state = await adapter.verificationState(page)
      } catch {
        continue // Page is mid-navigation.
      }

      if (state === 'challenge-page' || state === 'unsolved') {
        if (!askedToVerify && Date.now() - started > SELF_SOLVE_GRACE_MS) {
          askedToVerify = true
          await page.bringToFront().catch(() => undefined)
          this.setState({ phase: 'waiting-user', message: 'Complete the Cloudflare check in the browser window' })
        } else if (!askedToVerify) {
          this.setState({ phase: 'verifying', message: 'Waiting for Cloudflare to verify…' })
        }
        continue
      }

      if (!verifiedAt) verifiedAt = Date.now()
      const cooledDown = Date.now() - lastClick > CLICK_COOLDOWN_MS
      const autoClick = this.settings.get().autoClickDownload
      if (autoClick && clicks < MAX_AUTO_CLICKS && cooledDown) {
        if (!askedToClick) this.setState({ phase: 'capturing', message: 'Looking for the download button…' })
        const clicked = await adapter.triggerDownload(page).catch(() => false)
        if (clicked) {
          clicks++
          lastClick = Date.now()
          continue
        }
      }

      const waitedForAutoClick = !autoClick || Date.now() - verifiedAt > CLICK_PROMPT_DELAY_MS
      if (cooledDown && waitedForAutoClick && !askedToClick) {
        askedToClick = true
        await page.bringToFront().catch(() => undefined)
        this.setState({ phase: 'waiting-user', message: 'Click the download button in the browser window' })
      }
    }
  }

  /** Hosts love opening ad tabs on click. Close new tabs on other sites unless they start a download. */
  private closeAdPopup(popup: Page, main: Page): void {
    let downloading = false
    popup.once('download', () => (downloading = true))
    setTimeout(async () => {
      if (downloading || popup.isClosed()) return
      if (hostOf(popup.url()) !== hostOf(main.url())) {
        await popup.close().catch(() => undefined)
        await main.bringToFront().catch(() => undefined)
      }
    }, 3000)
  }

  /** Headers aria2 needs to fetch the file as the browser would. */
  private async requestHeaders(context: BrowserContext, url: string): Promise<Record<string, string>> {
    const cookies = await context.cookies(url).catch(() => [])
    const headers: Record<string, string> = { 'User-Agent': this.userAgent }
    if (cookies.length) headers.Cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const referer = context.pages()[0]?.url()
    if (referer?.startsWith('http')) headers.Referer = referer
    return headers
  }
}
