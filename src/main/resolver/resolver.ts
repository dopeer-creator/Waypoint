import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import log from 'electron-log/main'
import { chromium, type BrowserContext, type Download, type Page } from 'patchright'
import type { BrowserChannel, ResolverPhase, ResolverState } from '../../shared/types'
import { BROWSER_NAMES, openInBrowser } from '../browsers'
import type { BrowserDownload, DownloadDecision } from '../capture'
import type { LinkRecord, Store } from '../db'
import { hostOf, sanitizeSegment } from '../links'
import { browserProfileDir } from '../paths'
import type { SettingsService } from '../settings'
import type { HostAdapter } from './adapter'
import { adapterFor } from './adapters'

const SELF_SOLVE_GRACE_MS = 6000
const POLL_MS = 700
const MAX_AUTO_CLICKS = 6
const CLICK_COOLDOWN_MS = 4000
const AUTO_CLICK_PROGRESS_DELAY_MS = 8000
/** Browser automation workers; deliberately separate from aria2's download concurrency. */
const AUTO_RESOLVE_CONCURRENCY = 6
/** How long a link may sit waiting on the user — its turn to ask, then the check itself — before giving up. */
const HUMAN_WAIT_BUDGET_MS = 5 * 60_000
/** How many times a run will reopen the browser after it closes on its own before giving up on the run. */
const MAX_BROWSER_RELAUNCHES = 3

type StopReason = 'stop' | 'skip' | 'browser-closed'

class ResolveAborted extends Error {
  constructor(readonly reason: StopReason) {
    super(reason)
  }
}

/**
 * The per-link time budget, split in two: time the page itself gets to produce a download, and time spent waiting
 * on the user. Waiting is paused out of the page budget so a link can't fail just because the user was busy
 * passing the check on another tab, but it has its own cap so nothing waits forever if they walk away.
 */
class ResolveClock {
  private readonly started = Date.now()
  private pausedAt = 0
  private pausedTotal = 0

  constructor(
    private readonly pageBudgetMs: number,
    private readonly waitBudgetMs: number
  ) {}

  pause(): void {
    if (!this.pausedAt) this.pausedAt = Date.now()
  }

  resume(): void {
    if (!this.pausedAt) return
    this.pausedTotal += Date.now() - this.pausedAt
    this.pausedAt = 0
  }

  expiredReason(): 'page' | 'user' | null {
    const pausedNow = this.pausedAt ? Date.now() - this.pausedAt : 0
    const waited = this.pausedTotal + pausedNow
    if (waited > this.waitBudgetMs) return 'user'
    if (Date.now() - this.started - waited > this.pageBudgetMs) return 'page'
    return null
  }
}

interface Captured {
  url: string
  filename: string
  /** Main-page URL that initiated the browser download, used as the aria2 Referer. */
  referer: string
  /** Bytes, from the Content-Length of the response that became the download; 0 when the host didn't say. */
  size: number
}

interface Resolved extends Captured {
  headers: Record<string, string>
}

function siteOf(url: string): string {
  const host = hostOf(url)
  if (!host) return ''
  const parts = host.split('.')
  const twoPartSuffix =
    parts.length > 2 &&
    parts.at(-1)!.length === 2 &&
    ['co', 'com', 'net', 'org', 'ac', 'gov', 'edu'].includes(parts.at(-2)!)
  return parts.slice(twoPartSuffix ? -3 : -2).join('.')
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

const IDLE: ResolverState = {
  running: false,
  phase: 'idle',
  current: 0,
  total: 0,
  currentLinkId: null,
  message: null
}

export function installedBrowsers(): BrowserChannel[] {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[]
  const found: BrowserChannel[] = []
  if (roots.some((r) => existsSync(join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')))) found.push('chrome')
  if (roots.some((r) => existsSync(join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')))) found.push('msedge')
  return found
}

/**
 * Resolves pending links in two modes:
 * - handoff: open the link as a normal tab in the user's own browser; the user passes any check and clicks
 *   Download, and the Waypoint extension reports the download here.
 * - automated: drive one persistent Chrome/Edge BrowserContext with a bounded pool of reusable tabs.
 *
 * Automated mode keeps the browser session alive for the whole run. A fixed number of worker tabs stay open and
 * are reused for the next pending link as soon as the previous link resolves.
 *
 * Events: 'state' (ResolverState), 'resolved' (linkId), 'failed' (linkId), 'finished', 'notice' (string).
 */
export class Resolver extends EventEmitter {
  state: ResolverState = IDLE

  private context: BrowserContext | null = null
  private userAgent = ''
  private runAbort: AbortController | null = null
  private readonly activeAborts = new Map<number, AbortController>()
  private readonly activePhases = new Map<number, ResolverPhase>()
  private readonly workerPages = new Set<Page>()
  private handoff: { link: LinkRecord; result: ReturnType<typeof deferred<Resolved>> } | null = null
  private stopRequested = false
  /** The one link currently allowed to ask the user to pass a check; other blocked tabs wait for it. */
  private verifyTurn: number | null = null
  /** In-flight browser launch, so parallel workers share one browser instead of racing to start four. */
  private contextPromise: Promise<BrowserContext> | null = null
  /** Blank tab kept open for the whole run: closing the last tab would take the browser down with it. */
  private keeperPage: Page | null = null
  private relaunches = 0

  /** Set by the app: whether the browser extension has checked in recently. */
  extensionConnected: () => boolean = () => false

  constructor(
    private readonly store: Store,
    private readonly settings: SettingsService
  ) {
    super()
  }

  async start(): Promise<void> {
    if (this.state.running || this.store.countPending() === 0) return

    this.stopRequested = false
    this.runAbort = new AbortController()
    const runSignal = this.runAbort.signal
    const total = this.store.countPending()

    this.setState({
      ...IDLE,
      running: true,
      phase: 'launching',
      total,
      message: 'Opening browser…'
    })

    try {
      if (this.settings.get().resolveMode === 'automated') {
        await this.startAutomated(total, runSignal)
      } else {
        await this.startHandoff(total, runSignal)
      }
    } catch (err) {
      log.error('[resolver] run failed', err)
      this.emit('notice', `Resolver stopped: ${(err as Error).message}`)
    } finally {
      await this.closeContext()
      this.runAbort = null
      this.activeAborts.clear()
      this.activePhases.clear()
      this.workerPages.clear()
      this.verifyTurn = null
      this.relaunches = 0
      this.stopRequested = false
      this.setState(IDLE)
      this.emit('finished')
    }
  }

  stop(): void {
    this.stopRequested = true
    this.runAbort?.abort('stop')
    for (const controller of this.activeAborts.values()) controller.abort('stop')
  }

  skip(): void {
    const currentId = this.state.currentLinkId
    if (currentId !== null) {
      const controller = this.activeAborts.get(currentId)
      if (controller) {
        controller.abort('skip')
        return
      }
    }
    if (this.handoff) this.runAbort?.abort('skip')
  }

  /** Called for each download the browser extension reports. */
  offerDownload(download: BrowserDownload): DownloadDecision {
    const handoff = this.handoff
    if (!handoff || handoff.result.settled) return { take: false, closeTab: false }
    const site = siteOf(handoff.link.url)
    const sources = [download.tabUrl, download.referrer, download.url].map(siteOf)
    if (!site || !sources.includes(site)) {
      log.info(`[handoff] ignored a download from ${hostOf(download.url)} while waiting on ${handoff.link.host}`)
      return { take: false, closeTab: false }
    }
    const headers: Record<string, string> = {}
    if (download.userAgent) headers['User-Agent'] = download.userAgent
    if (download.cookies) headers.Cookie = download.cookies
    if (download.referrer.startsWith('http')) headers.Referer = download.referrer
    handoff.result.resolve({
      url: download.url,
      filename: download.filename || handoff.link.filename || '',
      headers,
      referer: download.referrer,
      // The extension reports what the browser told it, which doesn't include the size; aria2 fills it in once
      // the download starts, as it always did for this mode.
      size: 0
    })
    return { take: true, closeTab: true }
  }

  async resetProfile(): Promise<void> {
    if (this.state.running) throw new Error('Stop resolving before resetting the browser profile')
    await rm(browserProfileDir(this.settings.get().browserChannel), { recursive: true, force: true })
  }

  private setState(patch: Partial<ResolverState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  private publishAutomatedProgress(total: number, completed: number): void {
    const activeEntries = [...this.activePhases.entries()]
    const activeCount = activeEntries.length
    const currentLinkId = activeEntries[0]?.[0] ?? null

    if (!activeCount) {
      this.setState({
        current: Math.min(total, completed),
        total,
        currentLinkId: null,
        phase: completed >= total ? 'capturing' : 'loading',
        message: completed >= total ? `Resolved ${completed} of ${total}` : 'Waiting for the next link…'
      })
      return
    }

    const hasVerifying = activeEntries.some(([, phase]) => phase === 'verifying' || phase === 'waiting-user')
    const hasCapturing = activeEntries.some(([, phase]) => phase === 'capturing')
    const phase: ResolverPhase = hasVerifying ? 'verifying' : hasCapturing ? 'capturing' : 'loading'
    const activeLabel = activeCount === 1 ? '1 tab' : `${activeCount} tabs`

    this.setState({
      current: Math.min(total, completed + 1),
      total,
      currentLinkId,
      phase,
      message: `Resolving ${completed + 1}–${Math.min(total, completed + activeCount)} of ${total} · ${activeLabel} active`
    })
  }

  private setWorkerPhase(linkId: number, phase: ResolverPhase): void {
    this.activePhases.set(linkId, phase)
  }

  private async startHandoff(total: number, runSignal: AbortSignal): Promise<void> {
    let completed = 0

    while (!this.stopRequested && !runSignal.aborted) {
      const link = this.store.nextPendingLink()
      if (!link) break

      this.setState({
        current: Math.min(total, completed + 1),
        total,
        currentLinkId: link.id,
        phase: 'loading',
        message: `Opening ${link.host}`
      })

      await this.resolveOne(link, runSignal)
      completed++
    }
  }

  /**
   * Up to AUTO_RESOLVE_CONCURRENCY links at once. Each link gets a fresh tab; when it resolves (or fails) that tab
   * is closed and the same slot immediately opens a new tab for the next pending link.
   */
  private async startAutomated(total: number, runSignal: AbortSignal): Promise<void> {
    // Keeper tab: a blank tab stays open for the whole run. Worker tabs come and go, and closing the last tab in
    // a window shuts the browser down, which would take every other link's tab with it.
    await this.ensureKeeper(await this.ensureContext())

    const workerCount = Math.min(AUTO_RESOLVE_CONCURRENCY, total)
    let completed = 0

    const worker = async (slot: number): Promise<void> => {
      while (!this.stopRequested && !runSignal.aborted) {
        const link = this.store.nextPendingLink()
        if (!link) return

        // Claim the link before the first await so another slot can't pick it up too.
        this.store.updateLink(link.id, { status: 'resolving', error: null })
        this.setWorkerPhase(link.id, 'loading')
        this.publishAutomatedProgress(total, completed)

        // Fetched per link, not once per run: if the browser died, this reopens it and the slot carries on.
        let page: Page
        try {
          const live = await this.ensureContext()
          page = await live.newPage()
          await this.ensureKeeper(live)
        } catch (err) {
          // The browser is going away (closed or stopping). Give the link back and let the run wind down.
          this.store.updateLink(link.id, { status: 'pending' })
          this.activePhases.delete(link.id)
          log.warn(`[resolver] slot ${slot} couldn't open a tab for link ${link.id}: ${(err as Error).message?.split('\n')[0]}`)
          return
        }

        this.workerPages.add(page)
        log.info(`[resolver] slot ${slot} opened a tab for link ${link.id} (${link.host})`)

        try {
          await this.resolveOne(link, runSignal, page)
        } finally {
          this.activePhases.delete(link.id)
          this.workerPages.delete(page)
          // Make sure a tab outlives this one, or closing it takes the whole browser (and the other slots) down.
          if (this.context) await this.ensureKeeper(this.context)
          await page.close().catch(() => undefined)
          log.info(`[resolver] slot ${slot} closed the tab for link ${link.id}`)
        }

        completed++
        this.publishAutomatedProgress(total, completed)
      }
    }

    await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i + 1)))
  }

  private async resolveOne(link: LinkRecord, runSignal: AbortSignal, page?: Page): Promise<void> {
    const controller = new AbortController()
    const onRunAbort = () => {
      if (!controller.signal.aborted) controller.abort(runSignal.reason ?? 'stop')
    }

    this.activeAborts.set(link.id, controller)
    runSignal.addEventListener('abort', onRunAbort, { once: true })

    this.store.updateLink(link.id, { status: 'resolving', error: null })

    const attempts = link.resolveAttempts + 1
    try {
      const captured =
        this.settings.get().resolveMode === 'handoff'
          ? await this.captureViaBrowser(link, controller.signal)
          : await this.captureAutomated(link, controller.signal, page!)

      this.store.updateLink(link.id, {
        status: 'resolved',
        directUrl: captured.url,
        headers: captured.headers,
        filename: sanitizeSegment(captured.filename, `download-${link.id}`),
        // Known now, from the response that became the download. Without this a batch only knows the size of the
        // few files aria2 has actually started, so its total reads as a lower bound and the disk-space guard is
        // working off a fraction of the real figure. Left alone when the host didn't say.
        ...(captured.size > 0 ? { totalBytes: captured.size } : {}),
        resolveAttempts: attempts,
        error: null
      })
      log.info(`[resolver] resolved ${link.url} -> ${hostOf(captured.url)} (${captured.filename})`)
      // The relaunch budget guards against a browser that can't stay up, not one that dies but still makes
      // progress. Any resolved link clears it, so a long batch can't trip the cap while it's working fine.
      this.relaunches = 0
      this.emit('resolved', link.id)
    } catch (err) {
      const reason = err instanceof ResolveAborted ? err.reason : null

      if (reason === 'stop' || reason === 'browser-closed') {
        // Back to pending so the link is retried, by this run if the browser comes back or by the next one.
        // The browser-closed notice comes from the context's close handler, once, not once per link in flight.
        this.store.updateLink(link.id, { status: 'pending' })
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
      runSignal.removeEventListener('abort', onRunAbort)
      this.activeAborts.delete(link.id)
    }
  }

  private async captureViaBrowser(link: LinkRecord, signal: AbortSignal): Promise<Resolved> {
    const { handoffBrowser, resolveTimeoutSec } = this.settings.get()
    const result = deferred<Resolved>()
    const onAbort = () => result.reject(new ResolveAborted((signal.reason as StopReason) ?? 'stop'))
    const timer = setTimeout(
      () => result.reject(new Error(`No download started within ${resolveTimeoutSec}s`)),
      resolveTimeoutSec * 1000
    )

    signal.addEventListener('abort', onAbort)
    if (signal.aborted) onAbort()
    this.handoff = { link, result }

    try {
      const name = BROWSER_NAMES[handoffBrowser]
      this.setState({ phase: 'loading', message: `Opening the link in ${name}…` })
      await openInBrowser(handoffBrowser, link.url)
      this.setState({
        phase: 'waiting-user',
        message: this.extensionConnected()
          ? `In ${name}: pass the check and click Download. Waypoint takes the file from there`
          : `Waypoint's browser extension isn't connected. Set it up in Settings, then click Download in ${name}`
      })
      return await result.promise
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      this.handoff = null
    }
  }

  private async captureAutomated(link: LinkRecord, signal: AbortSignal, page: Page): Promise<Resolved> {
    const context = await this.ensureContext()
    const captured = await this.capture(context, page, link, adapterFor(link.url), signal)
    return { ...captured, headers: await this.requestHeaders(context, captured.url, captured.referer) }
  }

  /** Workers call this per link, so a relaunch after the browser dies must not start one browser per worker. */
  private ensureContext(): Promise<BrowserContext> {
    if (this.context) return Promise.resolve(this.context)
    this.contextPromise ??= this.launchContext().finally(() => {
      this.contextPromise = null
    })
    return this.contextPromise
  }

  private async launchContext(): Promise<BrowserContext> {
    const preferred = this.settings.get().browserChannel
    const channels: BrowserChannel[] = [preferred, preferred === 'chrome' ? 'msedge' : 'chrome']
    let lastError: unknown

    for (const channel of channels) {
      try {
        this.setState({ phase: 'launching', message: `Opening ${channel === 'chrome' ? 'Chrome' : 'Edge'}…` })

        const context = await chromium.launchPersistentContext(browserProfileDir(channel), {
          channel,
          headless: false,
          // Waypoint only ever wants the URL — aria2 fetches the file. Accepting the download made Chrome spin up
          // its whole download machinery and then exit roughly 200ms later, taking every other tab's link with
          // it. Refusing up front still fires the 'download' event with the URL and filename, and Chrome lives.
          acceptDownloads: false,
          viewport: null,
          args: [
            '--no-first-run',
            '--no-default-browser-check',
            // Several links resolve in parallel tabs, but only one tab is ever in front. Without these, Chrome
            // throttles or pauses the background tabs, so their pages (and the Cloudflare check) stall until the
            // user happens to look at them.
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
          ]
        })

        if (channel !== preferred) this.emit('notice', `Couldn't start ${preferred}; using ${channel} instead`)

        context.on('close', () => {
          if (this.context !== context) return // our own teardown at the end of a run
          this.context = null
          this.keeperPage = null
          log.warn(`[resolver] browser closed unexpectedly with ${this.activePhases.size} link(s) in flight`)

          if (this.stopRequested || !this.state.running) return

          // A closed browser used to abort the entire run, so a single hiccup threw away every link that was
          // still resolving and only the one that had already finished survived. Now the links in flight go back
          // to pending (see resolveOne) and the workers just reopen the browser and carry on.
          if (++this.relaunches > MAX_BROWSER_RELAUNCHES) {
            this.emit('notice', 'The browser kept closing — resolving stopped')
            this.runAbort?.abort('stop')
            return
          }
          this.emit('notice', 'Browser closed — reopening it to finish the remaining links')

          // Unwind every link that was mid-resolve. Their pages died with the browser, so nothing else would
          // settle them: they'd sit on a dead tab until their own timeout, and the slots would never loop round
          // to reopen the browser. Aborting per link (not the run) sends them back to pending to be retried.
          for (const controller of this.activeAborts.values()) controller.abort('browser-closed')
        })

        this.context = context
        const page = context.pages()[0] ?? (await context.newPage())
        this.keeperPage = page
        this.userAgent = (await page.evaluate('navigator.userAgent')) as string
        return context
      } catch (err) {
        lastError = err
        log.warn(`[resolver] launch ${channel} failed`, err)
      }
    }

    throw new Error(`Could not start Chrome or Edge: ${(lastError as Error)?.message?.split('\n')[0]}`)
  }

  /**
   * True when a captured filename is demonstrably some *other* pending link's file. Deliberately narrow: a name
   * that merely differs from what we expected is fine (plenty of hosts rename on the way out), so this only
   * rejects a download that matches another link's expected name and not our own.
   */
  private belongsToAnotherLink(filename: string, link: LinkRecord): boolean {
    const got = filename.trim().toLowerCase()
    const mine = (link.filename ?? '').trim().toLowerCase()
    if (!got || !mine || got === mine) return false
    return this.store.listLinks().some((other) => other.id !== link.id && (other.filename ?? '').trim().toLowerCase() === got)
  }

  /** Guarantees a blank tab stays open, so a worker tab closing can never take the browser down with it. */
  private async ensureKeeper(context: BrowserContext): Promise<void> {
    if (this.keeperPage && !this.keeperPage.isClosed()) return
    this.keeperPage = await context.newPage().catch(() => null)
    this.keeperPage?.once('close', () => log.info('[resolver] keeper tab closed'))
  }

  private async closeContext(): Promise<void> {
    const context = this.context
    const pages = [...this.workerPages]
    this.context = null
    this.keeperPage = null

    for (const page of pages) await page.close().catch(() => undefined)
    await context?.close().catch(() => undefined)
  }

  /**
   * The page belongs to exactly one resolver worker and is reused for multiple links.
   * This method never closes or mutates another worker's page.
   */
  private async capture(
    context: BrowserContext,
    page: Page,
    link: LinkRecord,
    adapter: HostAdapter,
    signal: AbortSignal
  ): Promise<Captured> {
    if (page.isClosed()) throw new ResolveAborted('browser-closed')

    const result = deferred<Captured>()

    const onDownload = (download: Download) => {
      const url = download.url()
      const filename = download.suggestedFilename()

      // Several tabs resolve the same host at once, and their ad popups fire downloads all over the place. A
      // download that is plainly another pending link's file is not ours: taking it would resolve this link to
      // the wrong URL, so the batch quietly downloads one part twice and never gets this one.
      if (this.belongsToAnotherLink(filename, link)) {
        log.warn(`[resolver] link ${link.id}: ignored a download for ${filename} — that is another link's file`)
        return
      }

      const size = sizes.get(url) ?? lastAttachmentSize
      log.info(
        `[resolver] link ${link.id}: download captured from ${hostOf(url)} (${filename}${size ? `, ${size} bytes` : ', size unknown'})`
      )
      // No cancel needed: the context refuses downloads, so Chrome never started writing this file.
      result.resolve({ url, filename, referer: page.url(), size })
    }

    // The response that turns into the download carries Content-Length, so the exact size is already on the wire
    // here. Reading it costs nothing; asking the host separately would mean a second request against a link that
    // is often single-use.
    const sizes = new Map<string, number>()
    let lastAttachmentSize = 0
    const onResponse = (res: { url: () => string; headers: () => Record<string, string> }) => {
      const headers = res.headers()
      const len = Number(headers['content-length'] ?? 0)
      if (!Number.isFinite(len) || len <= 0) return
      sizes.set(res.url(), len)
      // Redirect chains mean the download's final URL may not be the one we saw, so keep the last attachment
      // response as a fallback.
      if (/attachment/i.test(headers['content-disposition'] ?? '')) lastAttachmentSize = len
    }

    // Every tab this link's page opens. They're all closed when the link finishes, so nothing is left behind.
    const popups = new Set<Page>()
    const onPopup = (popup: Page) => {
      popups.add(popup)
      popup.once('close', () => popups.delete(popup))
      popup.on('download', onDownload)
      popup.on('response', onResponse)
      this.closeAdPopup(popup, page, link.id)
    }

    const onAbort = () => result.reject(new ResolveAborted((signal.reason as StopReason) ?? 'stop'))
    const timeoutSec = this.settings.get().resolveTimeoutSec
    const clock = new ResolveClock(timeoutSec * 1000, HUMAN_WAIT_BUDGET_MS)
    const timer = setInterval(() => {
      const reason = clock.expiredReason()
      if (reason === 'page') result.reject(new Error(`Timed out after ${timeoutSec}s`))
      else if (reason === 'user') result.reject(new Error('The check was not completed in time'))
    }, 500)

    page.on('download', onDownload)
    page.on('popup', onPopup)
    page.on('response', onResponse)
    signal.addEventListener('abort', onAbort)
    if (signal.aborted) onAbort()

    this.setWorkerPhase(link.id, 'loading')

    page.goto(link.url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((err: Error) => {
      setTimeout(() => result.reject(new Error(`Could not open page: ${err.message.split('\n')[0]}`)), 2000)
    })

    void this.drive(context, page, adapter, () => result.settled, signal, link.id, clock)

    try {
      return await result.promise
    } finally {
      clearInterval(timer)
      // Never strand the turn on a link that's finished: the tabs waiting behind it would never get to ask.
      if (this.verifyTurn === link.id) this.verifyTurn = null
      signal.removeEventListener('abort', onAbort)
      page.off('popup', onPopup)
      page.off('download', onDownload)
      page.off('response', onResponse)
      for (const popup of popups) {
        if (popup.isClosed()) continue
        log.info(`[resolver] link ${link.id}: closing leftover popup ${hostOf(popup.url()) || popup.url()}`)
        await popup.close().catch(() => undefined)
      }
      log.info(`[resolver] link ${link.id}: capture cleaned up`)
    }
  }

  /** Watches verification state and drives the page to a download until the capture settles. */
  private async drive(
    context: BrowserContext,
    page: Page,
    adapter: HostAdapter,
    done: () => boolean,
    signal: AbortSignal,
    linkId: number,
    clock: ResolveClock
  ): Promise<void> {
    const started = Date.now()
    let clicks = 0
    let lastClick = 0
    let askedToVerify = false
    let askedToClick = false
    let lastState: string | null = null
    let loggedNoButton = false
    let verifiedAt = 0

    while (!done() && !signal.aborted) {
      await sleep(POLL_MS)
      if (done() || signal.aborted || page.isClosed()) return

      let state
      try {
        state = await adapter.verificationState(page)
      } catch {
        continue
      }
      if (state !== lastState) {
        log.info(`[resolver] link ${linkId}: verification ${lastState ?? 'start'} -> ${state}`)
        lastState = state
      }

      // Hosts like fuckingfast.co reset their Turnstile widget the moment the download button is clicked, so the
      // check reads "unsolved" again right after our first click, even though the next click no longer needs it.
      // Once a click has landed, only a full-page Cloudflare interstitial holds up clicking.
      const blocked = state === 'challenge-page' || (state === 'unsolved' && clicks === 0)

      if (blocked) {
        if (verifiedAt) {
          // The token expired before we got to click; wait for the check again.
          verifiedAt = 0
        }

        // Only one tab at a time may ask the user to pass a check. The rest wait quietly: they don't steal focus,
        // and every blocked tab's page clock is paused, so none of them can time out while the user is working
        // through another tab. Waiting has its own budget, so an abandoned run still ends.
        if (this.verifyTurn === null) this.verifyTurn = linkId
        clock.pause()

        if (this.verifyTurn !== linkId) {
          this.setWorkerPhase(linkId, 'verifying')
        } else if (!askedToVerify && Date.now() - started > SELF_SOLVE_GRACE_MS) {
          askedToVerify = true
          this.setWorkerPhase(linkId, 'waiting-user')
          await page.bringToFront().catch(() => undefined)
          this.setState({
            phase: 'waiting-user',
            currentLinkId: linkId,
            message: 'Complete the Cloudflare check in the browser window'
          })
        } else if (!askedToVerify) {
          this.setWorkerPhase(linkId, 'verifying')
        }
        continue
      }

      // Past the check: hand the turn to whichever tab is waiting behind us, and start the page clock again.
      if (this.verifyTurn === linkId) this.verifyTurn = null
      clock.resume()

      if (!verifiedAt) {
        verifiedAt = Date.now()
        this.setWorkerPhase(linkId, 'capturing')
      }

      const cooledDown = Date.now() - lastClick > CLICK_COOLDOWN_MS
      const autoClick = this.settings.get().autoClickDownload

      if (autoClick && clicks < MAX_AUTO_CLICKS && cooledDown) {
        if (Date.now() - verifiedAt > AUTO_CLICK_PROGRESS_DELAY_MS) {
          this.setState({
            phase: 'capturing',
            currentLinkId: linkId,
            message: 'Still looking for the download button…'
          })
        }

        const clicked = await adapter.triggerDownload(page).catch(() => null)
        if (clicked) {
          clicks++
          lastClick = Date.now()
          log.info(`[resolver] link ${linkId}: auto-click ${clicks}/${MAX_AUTO_CLICKS} landed on ${clicked}`)
          continue
        }
        if (clicks === 0 && Date.now() - verifiedAt > AUTO_CLICK_PROGRESS_DELAY_MS && !loggedNoButton) {
          loggedNoButton = true
          log.warn(`[resolver] link ${linkId}: no download button found on ${hostOf(page.url())}`)
        }
      }

      // Ask for a manual click once auto-click has had a real chance and failed: either it's off, or it's on
      // but has burned through MAX_AUTO_CLICKS attempts without landing a download. Without this fallback the
      // page just sits there silently until the whole per-link timeout fails it -- indistinguishable from a
      // hang, and the reason "still have to click manually" looked like automatic mode wasn't doing anything.
      const autoClickExhausted = autoClick && clicks >= MAX_AUTO_CLICKS
      if ((!autoClick || autoClickExhausted) && cooledDown && Date.now() - verifiedAt > AUTO_CLICK_PROGRESS_DELAY_MS && !askedToClick) {
        askedToClick = true
        await page.bringToFront().catch(() => undefined)
        this.setWorkerPhase(linkId, 'waiting-user')
        this.setState({
          phase: 'waiting-user',
          currentLinkId: linkId,
          message: autoClickExhausted
            ? "Couldn't find the download button automatically — click it in the browser window"
            : 'Click the download button in the browser window'
        })
      }
    }
  }

  /**
   * Closes a popup after a few seconds if it's on a different site (an ad) and hasn't started a download. Popups on
   * the host's own site (e.g. a dl. subdomain) stay open and are watched for the download until the link finishes.
   */
  private closeAdPopup(popup: Page, main: Page, linkId: number): void {
    let downloading = false
    let handled = false
    popup.once('download', () => (downloading = true))

    // A popup that loads a page on another site is an ad: close it as soon as that page commits. (A download never
    // commits a page, so this can't close a tab that's delivering the file.) A popup still on about:blank gets 3s.
    const check = async (final: boolean): Promise<void> => {
      if (handled || downloading || popup.isClosed()) return
      const popupSite = siteOf(popup.url())
      if (popupSite && popupSite === siteOf(main.url())) {
        if (final) {
          handled = true
          log.info(`[resolver] link ${linkId}: kept a popup on the host's own site (${hostOf(popup.url())})`)
        }
        return
      }
      if (!popupSite && !final) return
      handled = true
      log.info(`[resolver] link ${linkId}: closed an ad popup (${hostOf(popup.url()) || popup.url()})`)
      await popup.close().catch(() => undefined)
    }

    popup.on('framenavigated', (frame) => {
      if (frame === popup.mainFrame()) void check(false)
    })
    void check(false)
    setTimeout(() => void check(true), 3000)
  }

  /** Headers aria2 needs to fetch the file as the browser would. */
  private async requestHeaders(context: BrowserContext, url: string, referer: string): Promise<Record<string, string>> {
    const cookies = await context.cookies(url).catch(() => [])
    const headers: Record<string, string> = { 'User-Agent': this.userAgent }
    if (cookies.length) headers.Cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    if (referer?.startsWith('http')) headers.Referer = referer
    return headers
  }
}
