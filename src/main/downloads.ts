import { EventEmitter } from 'node:events'
import { mkdir, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import log from 'electron-log/main'
import type { Batch, CreateBatchInput, RemovalPlan, RemovalResult } from '../shared/types'
import { Aria2, Aria2Error, type Aria2Status } from './aria2'
import type { LinkRecord, Store } from './db'
import { extractArchive, findWinRAR, groupArchives } from './extract'
import { hostOf, sanitizeSegment } from './links'
import { RangeProxy } from './rangeproxy'
import { adapterFor } from './resolver/adapters'
import type { SettingsService } from './settings'

const POLL_MS = 1000

/** aria2 error codes that usually mean the direct link expired or lost its session: re-resolve instead of failing. */
const EXPIRED_CODES = new Set(['3', '22', '24'])

/**
 * Drives batches through aria2 and WinRAR. Tracks the gid of each link, polls aria2 for progress,
 * re-queues expired links for the resolver, and extracts a batch once every file has settled.
 *
 * Events: 'changed', 'needs-resolve', 'batch-done' (Batch), 'notice' (string).
 */
export class DownloadManager extends EventEmitter {
  private readonly gids = new Map<number, string>()
  private readonly speeds = new Map<number, number>()
  private pollTimer: NodeJS.Timeout | null = null
  private polling = false
  private extractQueue: Promise<void> = Promise.resolve()
  private readonly rangeProxy = new RangeProxy()
  /** Links whose current aria2 download goes through the range relay. */
  private readonly proxiedLinks = new Set<number>()

  constructor(
    private readonly store: Store,
    private readonly settings: SettingsService,
    readonly aria2: Aria2
  ) {
    super()
    settings.onChange((next, prev) => {
      if (next.maxConcurrent !== prev.maxConcurrent || next.speedLimitKib !== prev.speedLimitKib) {
        aria2.setGlobal({ maxConcurrent: next.maxConcurrent, speedLimitKib: next.speedLimitKib }).catch(() => undefined)
      }
    })
    aria2.on('crashed', () => {
      this.gids.clear()
      this.emit('notice', 'aria2 stopped unexpectedly — restarting')
      setTimeout(() => void this.init(), 2000)
    })
  }

  speedOf(linkId: number): number {
    return this.speeds.get(linkId) ?? 0
  }

  /** Bytes per second across every download, as of the last aria2 poll. */
  totalSpeed(): number {
    let sum = 0
    for (const speed of this.speeds.values()) sum += speed
    return sum
  }

  /** Starts aria2 and re-adds anything that was downloading when the app last closed. aria2 resumes from its .aria2 files. */
  async init(): Promise<void> {
    const s = this.settings.get()
    await this.rangeProxy.start()
    await this.aria2.start({ maxConcurrent: s.maxConcurrent, speedLimitKib: s.speedLimitKib })
    for (const link of this.store.linksWithDownloadStatus(['queued', 'active', 'paused'])) {
      if (link.status === 'resolved') await this.addToAria2(link, link.dlStatus === 'paused')
    }
    for (const batch of this.store.listBatches()) {
      if (batch.extractStatus === 'running') this.store.updateBatch(batch.id, { extractStatus: 'waiting' })
      this.checkBatchSettled(batch.id)
    }
    this.ensurePolling()
  }

  async shutdown(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    await this.aria2.stop()
    this.rangeProxy.stop()
  }

  async createBatch(input: CreateBatchInput): Promise<Batch> {
    const links = input.linkIds
      .map((id) => this.store.getLink(id))
      .filter((l): l is LinkRecord => !!l && l.status === 'resolved' && l.batchId === null)
    if (!links.length) throw new Error('No resolved links to download')

    const name = sanitizeSegment(input.name, 'Batch')
    const dir = join(input.baseFolder, name)
    await mkdir(dir, { recursive: true })

    this.dedupeFilenames(links)
    const batch = this.store.insertBatch(name, dir, input.extract, input.deleteArchives, links.map((l) => l.id))
    this.settings.update({ baseFolder: input.baseFolder, extractDefault: input.extract, deleteArchivesAfterExtract: input.deleteArchives })

    for (const link of this.store.linksInBatch(batch.id)) await this.addToAria2(link, false)
    this.ensurePolling()
    this.emit('changed')
    return batch
  }

  /** Two links with the same name would fight over one file; suffix later ones before they reach aria2. */
  private dedupeFilenames(links: LinkRecord[]): void {
    const used = new Set<string>()
    for (const link of links) {
      const original = link.filename ?? `download-${link.id}`
      let name = original
      for (let n = 2; used.has(name.toLowerCase()); n++) {
        const dot = original.lastIndexOf('.')
        name = dot > 0 ? `${original.slice(0, dot)} (${n})${original.slice(dot)}` : `${original} (${n})`
      }
      used.add(name.toLowerCase())
      if (name !== link.filename) this.store.updateLink(link.id, { filename: name })
    }
  }

  private async addToAria2(link: LinkRecord, paused: boolean): Promise<void> {
    const batch = link.batchId !== null ? this.store.getBatch(link.batchId) : null
    if (!batch || !link.directUrl) return
    const s = this.settings.get()
    const adapter = adapterFor(link.url)
    const connections = String(Math.min(s.connectionsPerFile, adapter.maxConnections ?? 16))
    // Hosts that ignore range ends go through the local relay, which sends the link's headers itself.
    const viaProxy = this.rangeProxy.handles(link.directUrl)
    const uri = viaProxy ? this.rangeProxy.urlFor(link.id, link.directUrl, link.headers, link.filename) : link.directUrl
    const options: Record<string, string | string[]> = {
      dir: batch.dir,
      header: viaProxy ? [] : Object.entries(link.headers).map(([k, v]) => `${k}: ${v}`),
      split: connections,
      'max-connection-per-server': connections,
      pause: paused ? 'true' : 'false'
    }
    if (link.filename) options.out = link.filename
    try {
      const gid = await this.aria2.addUri(uri, options)
      this.gids.set(link.id, gid)
      if (viaProxy) this.proxiedLinks.add(link.id)
      else this.proxiedLinks.delete(link.id)
      this.store.updateLink(link.id, {
        dlStatus: paused ? 'paused' : 'queued',
        path: link.filename ? join(batch.dir, link.filename) : link.path,
        error: null
      })
    } catch (err) {
      log.error(`[downloads] addUri failed for link ${link.id}`, err)
      this.store.updateLink(link.id, { dlStatus: 'error', error: (err as Error).message })
    }
  }

  private ensurePolling(): void {
    if (!this.pollTimer) this.pollTimer = setInterval(() => void this.poll(), POLL_MS)
  }

  private async poll(): Promise<void> {
    if (this.polling || !this.aria2.ready) return
    const entries = [...this.gids.entries()]
    if (!entries.length) {
      if (this.speeds.size) {
        this.speeds.clear()
        this.emit('changed')
      }
      return
    }
    this.polling = true
    try {
      const statuses = await this.aria2.tellStatuses(entries.map(([, gid]) => gid))
      const settledBatches = new Set<number>()
      this.store.db.transaction(() => {
        statuses.forEach((status, i) => {
          const [linkId] = entries[i]
          const batchId = this.applyStatus(linkId, status)
          if (batchId !== null) settledBatches.add(batchId)
        })
      })()
      for (const id of settledBatches) this.checkBatchSettled(id)
      this.emit('changed')
    } catch (err) {
      log.warn('[downloads] poll failed', err)
    } finally {
      this.polling = false
    }
  }

  /** Writes one aria2 status to the store. Returns the batch id when the link reached a final state. */
  private applyStatus(linkId: number, status: Aria2Status | Aria2Error): number | null {
    const link = this.store.getLink(linkId)
    if (!link) {
      this.gids.delete(linkId)
      return null
    }
    if (status instanceof Aria2Error) {
      // aria2 forgot the gid (e.g. result purged); treat as lost and let the user retry.
      this.gids.delete(linkId)
      this.speeds.delete(linkId)
      this.store.updateLink(linkId, { dlStatus: 'error', error: 'Download was lost by aria2 — retry it' })
      return link.batchId
    }

    const total = Number(status.totalLength) || link.totalBytes
    const done = Number(status.completedLength) || 0
    const path = status.files?.[0]?.path || link.path
    this.speeds.set(linkId, status.status === 'active' ? Number(status.downloadSpeed) || 0 : 0)

    switch (status.status) {
      case 'active':
        this.store.updateLink(linkId, { dlStatus: 'active', totalBytes: total, doneBytes: done, path })
        return null
      case 'waiting':
        this.store.updateLink(linkId, { dlStatus: 'queued', totalBytes: total, doneBytes: done, path })
        return null
      case 'paused':
        this.store.updateLink(linkId, { dlStatus: 'paused', totalBytes: total, doneBytes: done, path })
        return null
      case 'complete':
        this.forget(linkId)
        this.store.updateLink(linkId, { dlStatus: 'complete', totalBytes: total, doneBytes: total, path, error: null })
        return link.batchId
      case 'removed':
        this.forget(linkId)
        return null
      case 'error': {
        this.forget(linkId)
        const code = status.errorCode ?? ''
        const message = status.errorMessage || `aria2 error ${code}`
        // The host ignored a range end while aria2 resumed a file with gaps. Move this download (and the host's
        // future ones) to the range relay and carry on from the same partial file. Checked per download, not per
        // host: files that started directly before the host was flagged still need switching when they hit it.
        if (code === '8' && /invalid range header/i.test(message) && link.directUrl && !this.proxiedLinks.has(linkId)) {
          log.info(`[downloads] ${hostOf(link.directUrl)} ignores range ends; resuming link ${linkId} through the range relay`)
          this.rangeProxy.markHost(link.directUrl)
          this.store.updateLink(linkId, { dlStatus: 'queued', doneBytes: done, error: null })
          void this.addToAria2({ ...link, doneBytes: done }, false).then(() => this.emit('changed'))
          return null
        }
        const looksExpired = EXPIRED_CODES.has(code) || /\b(401|403|404|410)\b/.test(message)
        if (looksExpired && link.resolveAttempts < this.settings.get().maxResolveAttempts) {
          log.info(`[downloads] link ${linkId} looks expired (${code}: ${message}); re-resolving`)
          this.store.updateLink(linkId, { dlStatus: 'expired', status: 'pending', doneBytes: done, error: 'Link expired — re-resolving' })
          this.emit('needs-resolve')
          return null
        }
        this.store.updateLink(linkId, { dlStatus: 'error', doneBytes: done, error: message })
        return link.batchId
      }
      default:
        // Unexpected aria2 state: leave the link as-is rather than crashing the poll.
        return null
    }
  }

  private forget(linkId: number): void {
    const gid = this.gids.get(linkId)
    this.gids.delete(linkId)
    this.speeds.delete(linkId)
    this.proxiedLinks.delete(linkId)
    this.rangeProxy.release(linkId)
    if (gid) this.aria2.call('aria2.removeDownloadResult', gid).catch(() => undefined)
  }

  /** Called by the resolver when a link that belongs to a batch has a fresh direct URL. */
  async onLinkResolved(linkId: number): Promise<void> {
    const link = this.store.getLink(linkId)
    if (!link || link.batchId === null) return
    await this.addToAria2(link, false)
    this.ensurePolling()
    this.emit('changed')
  }

  onLinkFailed(linkId: number): void {
    const link = this.store.getLink(linkId)
    if (link?.batchId != null) this.checkBatchSettled(link.batchId)
  }

  // Controls

  /** Reorders a queued download; -1 earlier, +1 later. Also nudges aria2's own waiting queue to match. */
  async moveLink(id: number, delta: number): Promise<void> {
    const neighbour = this.store.moveLinkOrder(id, delta)
    if (neighbour === null) return
    const gid = this.gids.get(id)
    if (gid) await this.aria2.call('aria2.changePosition', gid, delta, 'POS_CUR').catch(() => undefined)
    this.emit('changed')
  }

  async pauseLinks(ids: number[]): Promise<void> {
    for (const id of ids) {
      const gid = this.gids.get(id)
      if (gid) await this.aria2.pause(gid)
      else if (this.store.getLink(id)?.dlStatus === 'queued') this.store.updateLink(id, { dlStatus: 'paused' })
    }
    await this.poll()
  }

  async resumeLinks(ids: number[]): Promise<void> {
    for (const id of ids) {
      const link = this.store.getLink(id)
      if (!link || link.batchId === null) continue
      const gid = this.gids.get(id)
      if (gid) {
        await this.aria2.unpause(gid)
      } else if (link.dlStatus === 'error' || link.dlStatus === 'paused') {
        // Retry: re-resolve if the link never resolved, otherwise hand the stored URL back to aria2.
        if (link.status !== 'resolved') {
          this.store.updateLink(id, { status: 'pending', dlStatus: 'expired', error: null, resolveAttempts: 0 })
          this.emit('needs-resolve')
        } else {
          await this.addToAria2(link, false)
        }
      }
    }
    this.reopenBatches(ids)
    this.ensurePolling()
    await this.poll()
    this.emit('changed')
  }

  async pauseBatch(batchId: number): Promise<void> {
    const ids = this.store.linksInBatch(batchId).map((l) => l.id)
    await this.pauseLinks(ids)
    this.store.updateBatch(batchId, { status: 'paused' })
    this.emit('changed')
  }

  async resumeBatch(batchId: number): Promise<void> {
    const links = this.store.linksInBatch(batchId).filter((l) => l.dlStatus !== 'complete')
    this.store.updateBatch(batchId, { status: 'downloading' })
    await this.resumeLinks(links.map((l) => l.id))
  }

  async pauseAll(): Promise<void> {
    for (const batch of this.store.listBatches()) if (batch.status === 'downloading') await this.pauseBatch(batch.id)
  }

  async resumeAll(): Promise<void> {
    for (const batch of this.store.listBatches()) if (batch.status === 'paused') await this.resumeBatch(batch.id)
  }

  /**
   * The files Waypoint itself wrote for a batch: each link's own download, as a full path. Deliberately narrow —
   * removal is only responsible for what Waypoint put there. Extracted output, and anything the user added to
   * the folder, is never in this list.
   */
  private ownFiles(batchId: number): string[] {
    const batch = this.store.getBatch(batchId)
    if (!batch) return []
    const root = resolve(batch.dir)
    // A re-downloaded batch can share a folder and file names with an older one; its files are not ours to take.
    const claimed = new Set(
      this.store
        .listLinks()
        .filter((l) => l.batchId !== batchId && l.path)
        .map((l) => resolve(l.path!).toLowerCase())
    )
    const files = new Set<string>()
    for (const link of this.store.linksInBatch(batchId)) {
      const path = link.path ?? (link.filename ? join(batch.dir, link.filename) : null)
      if (!path) continue
      const full = resolve(path)
      const rel = relative(root, full)
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue // never outside the batch's own folder
      if (claimed.has(full.toLowerCase())) continue
      files.add(full)
    }
    return [...files]
  }

  /** What removing a batch with its files would delete, measured on disk rather than from the database. */
  async removalPlan(batchId: number): Promise<RemovalPlan> {
    const dir = this.store.getBatch(batchId)?.dir ?? ''
    let files = 0
    let bytes = 0
    for (const path of this.ownFiles(batchId)) {
      const info = await stat(path).catch(() => null)
      if (!info?.isFile()) continue // already gone — deleted after extraction, or moved by the user
      files++
      bytes += info.size
    }
    return { dir, files, bytes }
  }

  /**
   * Removes a batch from the list, and with deleteFiles its downloads too — permanently, to free the space now.
   * (Windows skips the Recycle Bin for files this size anyway.) The confirm dialog, which names the file count
   * and size, is the safeguard. aria2's .aria2 control files go with them.
   */
  async removeBatch(batchId: number, deleteFiles = false): Promise<RemovalResult> {
    const files = deleteFiles ? this.ownFiles(batchId) : []
    for (const link of this.store.linksInBatch(batchId)) {
      const gid = this.gids.get(link.id)
      if (gid) await this.aria2.remove(gid)
      this.gids.delete(link.id)
      this.speeds.delete(link.id)
      this.proxiedLinks.delete(link.id)
      this.rangeProxy.release(link.id)
    }
    this.store.deleteBatch(batchId)
    this.emit('changed')

    let deleted = 0
    let failed = 0
    for (const path of files) {
      await rm(`${path}.aria2`, { force: true }).catch(() => {})
      if (!(await stat(path).catch(() => null))?.isFile()) continue
      if (await deleteWithRetry(path)) deleted++
      else failed++
    }
    if (files.length) log.info(`[remove] batch ${batchId}: deleted ${deleted} file(s), ${failed} failed`)
    return { deleted, failed }
  }

  /** Stops downloads for links about to be deleted. */
  async dropLinks(ids: number[]): Promise<void> {
    for (const id of ids) {
      const gid = this.gids.get(id)
      if (gid) await this.aria2.remove(gid)
      this.gids.delete(id)
      this.speeds.delete(id)
      this.proxiedLinks.delete(id)
      this.rangeProxy.release(id)
    }
  }

  private reopenBatches(linkIds: number[]): void {
    const batchIds = new Set(linkIds.map((id) => this.store.getLink(id)?.batchId).filter((id): id is number => id != null))
    for (const id of batchIds) {
      const batch = this.store.getBatch(id)
      if (batch && (batch.status === 'error' || batch.status === 'done')) {
        this.store.updateBatch(id, { status: 'downloading', extractStatus: batch.extract ? 'waiting' : 'off', extractError: null })
      }
    }
  }

  // Batch completion and extraction

  /** A batch is settled when every link is complete or has failed for good. */
  private checkBatchSettled(batchId: number): void {
    const batch = this.store.getBatch(batchId)
    if (!batch || batch.status === 'extracting' || batch.status === 'done' || batch.status === 'error') return
    const links = this.store.linksInBatch(batchId)
    const settled = links.every((l) => l.dlStatus === 'complete' || (l.dlStatus === 'error' && !this.gids.has(l.id)))
    if (!links.length || !settled) return

    const failed = links.filter((l) => l.dlStatus !== 'complete').length
    if (batch.extract && batch.extractStatus === 'waiting') {
      this.store.updateBatch(batchId, { status: 'extracting' })
      this.extract(batchId)
    } else {
      this.finishBatch(batchId, failed)
    }
  }

  extract(batchId: number): void {
    this.extractQueue = this.extractQueue.then(() => this.runExtraction(batchId))
  }

  private async runExtraction(batchId: number): Promise<void> {
    const batch = this.store.getBatch(batchId)
    if (!batch) return
    const links = this.store.linksInBatch(batchId)
    const files = links.filter((l) => l.dlStatus === 'complete' && l.path).map((l) => l.path!)
    const sets = groupArchives(files)

    this.store.updateBatch(batchId, { status: 'extracting', extractStatus: 'running', extractError: null })
    this.emit('changed')

    const errors: string[] = []
    if (sets.length) {
      const winrar = await findWinRAR(this.settings.get().winrarPath)
      if (!winrar) {
        errors.push('WinRAR not found — install it or set its path in Settings')
      } else {
        for (const set of sets) {
          try {
            await extractArchive(winrar, set.first, batch.dir)
            // Only remove the originals when the user asked and this set extracted cleanly.
            if (batch.deleteArchives) {
              for (const member of set.members) await rm(member, { force: true }).catch(() => undefined)
            }
          } catch (err) {
            errors.push((err as Error).message)
          }
        }
      }
    }

    this.store.updateBatch(batchId, {
      extractStatus: errors.length ? 'error' : 'done',
      extractError: errors.length ? errors.join('\n') : null
    })
    this.finishBatch(batchId, links.filter((l) => l.dlStatus !== 'complete').length, errors.length)
  }

  private finishBatch(batchId: number, failedDownloads: number, failedExtractions = 0): void {
    const ok = failedDownloads === 0 && failedExtractions === 0
    this.store.updateBatch(batchId, { status: ok ? 'done' : 'error' })
    const batch = this.store.getBatch(batchId)
    this.emit('changed')
    if (batch) this.emit('batch-done', batch)
  }
}

/**
 * Deletes a file for good. aria2 may still hold a download it was just told to stop, and Windows refuses to
 * delete an open file, so a failure is retried briefly before it counts.
 */
async function deleteWithRetry(path: string, attempts = 6): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await rm(path)
      return true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true
      if (i === attempts - 1) log.warn(`[remove] could not delete ${path}: ${(err as Error).message}`)
      else await new Promise((r) => setTimeout(r, 500))
    }
  }
  return false
}
