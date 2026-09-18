export type LinkStatus = 'pending' | 'resolving' | 'resolved' | 'failed' | 'skipped'

/** 'none' until the link joins a batch. 'expired' means the host rejected the direct link and it is being re-resolved. */
export type DownloadStatus = 'none' | 'queued' | 'active' | 'paused' | 'complete' | 'error' | 'expired'

export type BatchStatus = 'downloading' | 'paused' | 'extracting' | 'done' | 'error'
export type ExtractStatus = 'off' | 'waiting' | 'running' | 'done' | 'error'

export type ThemeId =
  | 'system'
  | 'midnight'
  | 'carbon'
  | 'light'
  | 'ragnarok'
  | 'jackdaw'
  | 'nightcity'
  | 'tsushima'
  | 'rapture'
  | 'wasteland'
export type BrowserChannel = 'chrome' | 'msedge'

/** Browser that hand-off resolving opens links in. */
export type HandoffBrowser = 'brave' | 'chrome' | 'edge' | 'default'

/**
 * 'handoff': links open as normal tabs in the user's own browser; the Waypoint extension hands the download over.
 * 'automated': Waypoint drives a separate Chrome itself (sites with Cloudflare checks usually reject this).
 */
export type ResolveMode = 'handoff' | 'automated'

export interface LinkItem {
  id: number
  url: string
  host: string
  status: LinkStatus
  directUrl: string | null
  filename: string | null
  error: string | null
  batchId: number | null
  dlStatus: DownloadStatus
  totalBytes: number
  doneBytes: number
  /** Bytes per second; live value, not stored. */
  speed: number
  path: string | null
  resolveAttempts: number
  createdAt: number
}

export interface Batch {
  id: number
  name: string
  dir: string
  extract: boolean
  /** Delete the original archives once extraction succeeds. */
  deleteArchives: boolean
  status: BatchStatus
  extractStatus: ExtractStatus
  extractError: string | null
  createdAt: number
}

export type ResolverPhase = 'idle' | 'launching' | 'loading' | 'verifying' | 'waiting-user' | 'capturing'

export interface ResolverState {
  running: boolean
  phase: ResolverPhase
  /** 1-based position of the link being resolved within this run. */
  current: number
  total: number
  currentLinkId: number | null
  message: string | null
}

export interface AppStats {
  speed: number
  active: number
  queued: number
  total: number
}

export interface AppSnapshot {
  links: LinkItem[]
  batches: Batch[]
  resolver: ResolverState
  stats: AppStats
  /** The browser extension has checked in recently. */
  extensionConnected: boolean
  /** Destination themeId -> wallpaper file mtime; a present entry means the user set a custom background. */
  themeMedia: Record<string, number>
}

export interface Settings {
  theme: ThemeId
  baseFolder: string
  extractDefault: boolean
  maxConcurrent: number
  connectionsPerFile: number
  /** KiB/s, 0 = unlimited. */
  speedLimitKib: number
  resolveMode: ResolveMode
  handoffBrowser: HandoffBrowser
  /** Browser for automated resolving. */
  browserChannel: BrowserChannel
  /** Seconds to wait on one link (including manual verification) before marking it failed. */
  resolveTimeoutSec: number
  autoClickDownload: boolean
  winrarPath: string
  clipboardWatch: boolean
  /** Hosts the user said "never ask again" to when the clipboard offered their links. */
  clipboardIgnoreHosts: string[]
  /** Delete original archives after a successful extraction (default off). */
  deleteArchivesAfterExtract: boolean
  /** Removing a batch also deletes its downloaded files (default on; the dialog asks each time). */
  deleteFilesOnRemove: boolean
  closeToTray: boolean
  maxResolveAttempts: number
  /** How much to darken a premium theme's background image so text stays readable, 0-90 (%). */
  sceneDim: number
}

export interface AddLinksResult {
  added: number
  duplicates: number
  invalid: number
}

export interface CreateBatchInput {
  name: string
  baseFolder: string
  extract: boolean
  deleteArchives: boolean
  linkIds: number[]
}

/** What removing a batch with its files would delete: only files Waypoint downloaded that are still on disk. */
export interface RemovalPlan {
  dir: string
  files: number
  bytes: number
}

export interface RemovalResult {
  /** Files deleted. */
  deleted: number
  /** Files that couldn't be moved — usually still open in another program. */
  failed: number
}

/** Total download speed over time, for the Downloads page's chart. */
export interface SpeedSeries {
  /** Seconds per point. */
  step: number
  /** Epoch second at which the last point's bucket starts. */
  end: number
  /** Average bytes/s in each bucket, oldest first. */
  values: number[]
  /** The configured speed cap in bytes/s, 0 when unlimited. */
  limit: number
}

export interface DiskSpace {
  free: number
  total: number
}

/** Links found on the clipboard, offered to the user before adding. */
export interface ClipboardOffer {
  text: string
  count: number
  hosts: string[]
}

/** What the user did with a clipboard offer. Sent back so the watcher knows the prompt is closed. */
export interface ClipboardAnswer {
  /** The offer's links, exactly as they were offered. */
  text: string
  /** True when the links were added — nothing to remember, they're in the list now. */
  added: boolean
  /** Stop offering anything from these links' hosts. */
  ignoreHosts: boolean
}

export interface EnvInfo {
  version: string
  winrarPath: string | null
  aria2Ready: boolean
  aria2Version: string | null
  browsers: BrowserChannel[]
  handoffBrowsers: HandoffBrowser[]
  /** Folder the user loads into their browser as an unpacked extension. */
  extensionFolder: string
  extensionVersion: string | null
  userDataDir: string
}

export type UpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none'; version: string }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

export interface Toast {
  kind: 'info' | 'success' | 'error'
  text: string
}
