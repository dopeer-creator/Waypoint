import Database from 'better-sqlite3'
import type {
  Batch,
  BatchStatus,
  DownloadStatus,
  ExtractStatus,
  LinkItem,
  LinkStatus,
  Settings
} from '../shared/types'
import { filenameHint, hostOf } from './links'

/** A link as stored, including request headers (cookies) that never leave the main process. */
export interface LinkRecord extends Omit<LinkItem, 'speed'> {
  headers: Record<string, string>
}

interface LinkRow {
  id: number
  url: string
  host: string
  status: string
  direct_url: string | null
  headers: string | null
  filename: string | null
  error: string | null
  batch_id: number | null
  dl_status: string
  total_bytes: number
  done_bytes: number
  path: string | null
  resolve_attempts: number
  created_at: number
}

interface BatchRow {
  id: number
  name: string
  dir: string
  extract: number
  delete_archives: number
  status: string
  extract_status: string
  extract_error: string | null
  created_at: number
}

const MIGRATIONS = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE batches (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    dir TEXT NOT NULL,
    extract INTEGER NOT NULL,
    status TEXT NOT NULL,
    extract_status TEXT NOT NULL,
    extract_error TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE links (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL,
    host TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    direct_url TEXT,
    headers TEXT,
    filename TEXT,
    error TEXT,
    batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
    dl_status TEXT NOT NULL DEFAULT 'none',
    total_bytes INTEGER NOT NULL DEFAULT 0,
    done_bytes INTEGER NOT NULL DEFAULT 0,
    path TEXT,
    resolve_attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX links_batch ON links(batch_id);
  CREATE INDEX links_status ON links(status);
  `,
  `
  ALTER TABLE batches ADD COLUMN delete_archives INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE links ADD COLUMN ord INTEGER NOT NULL DEFAULT 0;
  `
]

const LINK_COLUMNS: Partial<Record<keyof LinkRecord, string>> = {
  status: 'status',
  directUrl: 'direct_url',
  headers: 'headers',
  filename: 'filename',
  error: 'error',
  batchId: 'batch_id',
  dlStatus: 'dl_status',
  totalBytes: 'total_bytes',
  doneBytes: 'done_bytes',
  path: 'path',
  resolveAttempts: 'resolve_attempts'
}

const BATCH_COLUMNS: Partial<Record<keyof Batch, string>> = {
  name: 'name',
  status: 'status',
  extractStatus: 'extract_status',
  extractError: 'extract_error'
}

function toLink(row: LinkRow): LinkRecord {
  return {
    id: row.id,
    url: row.url,
    host: row.host,
    status: row.status as LinkStatus,
    directUrl: row.direct_url,
    headers: row.headers ? (JSON.parse(row.headers) as Record<string, string>) : {},
    filename: row.filename,
    error: row.error,
    batchId: row.batch_id,
    dlStatus: row.dl_status as DownloadStatus,
    totalBytes: row.total_bytes,
    doneBytes: row.done_bytes,
    path: row.path,
    resolveAttempts: row.resolve_attempts,
    createdAt: row.created_at
  }
}

function toBatch(row: BatchRow): Batch {
  return {
    id: row.id,
    name: row.name,
    dir: row.dir,
    extract: row.extract === 1,
    deleteArchives: row.delete_archives === 1,
    status: row.status as BatchStatus,
    extractStatus: row.extract_status as ExtractStatus,
    extractError: row.extract_error,
    createdAt: row.created_at
  }
}

export class Store {
  readonly db: Database.Database

  constructor(file: string) {
    this.db = new Database(file)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    const version = this.db.pragma('user_version', { simple: true }) as number
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v])
        this.db.pragma(`user_version = ${v + 1}`)
      })()
    }
  }

  close(): void {
    this.db.close()
  }

  // Settings

  readSettings(): Partial<Settings> {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = 'app'`).get() as { value: string } | undefined
    return row ? (JSON.parse(row.value) as Partial<Settings>) : {}
  }

  writeSettings(settings: Settings): void {
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify(settings))
  }

  // Links

  /** Inserts new grabber links, skipping URLs already waiting in the grabber or in an unfinished download. */
  insertLinks(urls: string[]): { added: number; duplicates: number } {
    const existing = new Set(
      (
        this.db
          .prepare(`SELECT url FROM links WHERE batch_id IS NULL OR dl_status != 'complete'`)
          .all() as { url: string }[]
      ).map((r) => r.url)
    )
    const insert = this.db.prepare(`INSERT INTO links (url, host, filename, created_at) VALUES (?, ?, ?, ?)`)
    let added = 0
    let duplicates = 0
    this.db.transaction(() => {
      const now = Date.now()
      for (const url of urls) {
        if (existing.has(url)) {
          duplicates++
          continue
        }
        insert.run(url, hostOf(url), filenameHint(url), now)
        existing.add(url)
        added++
      }
    })()
    return { added, duplicates }
  }

  listLinks(): LinkRecord[] {
    return (this.db.prepare(`SELECT * FROM links ORDER BY id`).all() as LinkRow[]).map(toLink)
  }

  getLink(id: number): LinkRecord | null {
    const row = this.db.prepare(`SELECT * FROM links WHERE id = ?`).get(id) as LinkRow | undefined
    return row ? toLink(row) : null
  }

  linksInBatch(batchId: number): LinkRecord[] {
    // Effective order: the manual `ord` if set, else the insertion id (queue reordering writes `ord`).
    return (
      this.db.prepare(`SELECT * FROM links WHERE batch_id = ? ORDER BY COALESCE(NULLIF(ord, 0), id)`).all(batchId) as LinkRow[]
    ).map(toLink)
  }

  /** Swaps a link's queue position with its neighbour `delta` steps away. Returns the neighbour id, or null. */
  moveLinkOrder(id: number, delta: number): number | null {
    const link = this.getLink(id)
    if (!link || link.batchId === null) return null
    const rows = this.db
      .prepare(`SELECT id, COALESCE(NULLIF(ord, 0), id) AS eff FROM links WHERE batch_id = ? ORDER BY eff`)
      .all(link.batchId) as { id: number; eff: number }[]
    const idx = rows.findIndex((r) => r.id === id)
    const target = idx + delta
    if (idx < 0 || target < 0 || target >= rows.length) return null
    const a = rows[idx]
    const b = rows[target]
    const set = this.db.prepare(`UPDATE links SET ord = ? WHERE id = ?`)
    this.db.transaction(() => {
      set.run(b.eff, a.id)
      set.run(a.eff, b.id)
    })()
    return b.id
  }

  linksWithDownloadStatus(statuses: DownloadStatus[]): LinkRecord[] {
    const marks = statuses.map(() => '?').join(', ')
    return (
      this.db.prepare(`SELECT * FROM links WHERE dl_status IN (${marks}) ORDER BY id`).all(...statuses) as LinkRow[]
    ).map(toLink)
  }

  /** Re-resolves of links already in a batch go first so stalled downloads recover quickly. */
  nextPendingLink(): LinkRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM links WHERE status = 'pending' ORDER BY batch_id IS NULL, id LIMIT 1`)
      .get() as LinkRow | undefined
    return row ? toLink(row) : null
  }

  countPending(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM links WHERE status = 'pending'`).get() as { n: number }).n
  }

  updateLink(id: number, patch: Partial<LinkRecord>): void {
    const sets: string[] = []
    const values: unknown[] = []
    for (const [key, value] of Object.entries(patch)) {
      const column = LINK_COLUMNS[key as keyof LinkRecord]
      if (!column) continue
      sets.push(`${column} = ?`)
      values.push(key === 'headers' ? JSON.stringify(value) : value)
    }
    if (!sets.length) return
    this.db.prepare(`UPDATE links SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
  }

  updateLinks(ids: number[], patch: Partial<LinkRecord>): void {
    this.db.transaction(() => ids.forEach((id) => this.updateLink(id, patch)))()
  }

  deleteLinks(ids: number[]): void {
    const del = this.db.prepare(`DELETE FROM links WHERE id = ?`)
    this.db.transaction(() => ids.forEach((id) => del.run(id)))()
  }

  // Batches

  insertBatch(name: string, dir: string, extract: boolean, deleteArchives: boolean, linkIds: number[]): Batch {
    return this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO batches (name, dir, extract, delete_archives, status, extract_status, created_at) VALUES (?, ?, ?, ?, 'downloading', ?, ?)`
        )
        .run(name, dir, extract ? 1 : 0, deleteArchives ? 1 : 0, extract ? 'waiting' : 'off', Date.now())
      const batchId = Number(info.lastInsertRowid)
      const assign = this.db.prepare(`UPDATE links SET batch_id = ?, dl_status = 'queued' WHERE id = ?`)
      for (const id of linkIds) assign.run(batchId, id)
      return this.getBatch(batchId)!
    })()
  }

  getBatch(id: number): Batch | null {
    const row = this.db.prepare(`SELECT * FROM batches WHERE id = ?`).get(id) as BatchRow | undefined
    return row ? toBatch(row) : null
  }

  listBatches(): Batch[] {
    return (this.db.prepare(`SELECT * FROM batches ORDER BY id DESC`).all() as BatchRow[]).map(toBatch)
  }

  updateBatch(id: number, patch: Partial<Batch>): void {
    const sets: string[] = []
    const values: unknown[] = []
    for (const [key, value] of Object.entries(patch)) {
      const column = BATCH_COLUMNS[key as keyof Batch]
      if (!column) continue
      sets.push(`${column} = ?`)
      values.push(value)
    }
    if (!sets.length) return
    this.db.prepare(`UPDATE batches SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
  }

  deleteBatch(id: number): void {
    this.db.prepare(`DELETE FROM batches WHERE id = ?`).run(id)
  }
}
