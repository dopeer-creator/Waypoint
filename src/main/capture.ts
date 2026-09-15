import { EventEmitter } from 'node:events'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { app } from 'electron'
import log from 'electron-log/main'
import { EXTENSION_ID } from '../shared/extension'

/** A download the extension saw start in the user's browser. */
export interface BrowserDownload {
  url: string
  filename: string
  referrer: string
  /** URL of the tab the download came from, when the extension could find it. */
  tabUrl: string
  cookies: string
  userAgent: string
}

export interface DownloadDecision {
  /** Waypoint takes the file; the extension cancels the browser's own download. */
  take: boolean
  /** Close the host's tab once its download is handed over. */
  closeTab: boolean
}

const CONNECTED_WINDOW_MS = 90_000
const MAX_BODY_BYTES = 64 * 1024

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function parseDownload(raw: string): BrowserDownload | null {
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  const url = str(body.url, 4096)
  if (!/^https?:\/\//i.test(url)) return null
  return {
    url,
    filename: str(body.filename, 512),
    referrer: str(body.referrer, 4096),
    tabUrl: str(body.tabUrl, 4096),
    cookies: str(body.cookies, 32_000),
    userAgent: str(body.userAgent, 512)
  }
}

/**
 * Localhost endpoint for the Waypoint browser extension. Only POSTs carrying the extension's own
 * chrome-extension:// Origin are accepted; web pages can't forge that header, so sites can't push downloads in.
 *
 * Events: 'status' (connected: boolean) when the extension checks in or goes quiet.
 */
export class CaptureServer extends EventEmitter {
  private server: Server | null = null
  private lastSeen = 0
  private wasConnected = false
  extensionVersion: string | null = null
  decide: (download: BrowserDownload) => DownloadDecision = () => ({ take: false, closeTab: false })

  constructor(readonly port: number) {
    super()
  }

  get connected(): boolean {
    return Date.now() - this.lastSeen < CONNECTED_WINDOW_MS
  }

  start(): void {
    const server = createServer((req, res) => void this.handle(req, res))
    server.on('error', (err) => log.warn(`[capture] could not listen on 127.0.0.1:${this.port}`, err))
    server.listen(this.port, '127.0.0.1', () => log.info(`[capture] listening on 127.0.0.1:${this.port}`))
    this.server = server
    setInterval(() => this.checkStatus(), 5000).unref()
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  private checkStatus(): void {
    const connected = this.connected
    if (connected === this.wasConnected) return
    this.wasConnected = connected
    log.info(`[capture] browser extension ${connected ? 'connected' : 'went quiet'}`)
    this.emit('status', connected)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST' || req.headers.origin !== `chrome-extension://${EXTENSION_ID}`) {
      send(403, { error: 'forbidden' })
      return
    }

    this.lastSeen = Date.now()
    this.extensionVersion = str(req.headers['x-waypoint-extension'], 32) || this.extensionVersion
    this.checkStatus()

    const path = (req.url ?? '').split('?')[0]
    if (path === '/v1/status') {
      send(200, { app: 'waypoint', version: app.getVersion() })
      return
    }
    if (path === '/v1/capture') {
      const download = parseDownload(await readBody(req).catch(() => ''))
      if (!download) {
        send(400, { error: 'bad request' })
        return
      }
      send(200, this.decide(download))
      return
    }
    send(404, { error: 'not found' })
  }
}
