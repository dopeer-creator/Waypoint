import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import log from 'electron-log/main'
import { hostOf } from './links'

interface Target {
  url: string
  headers: Record<string, string>
}

const PASS_HEADERS = ['content-type', 'content-disposition', 'accept-ranges', 'last-modified', 'etag']

/**
 * Local HTTP relay for hosts that ignore the end of a byte range: asked for "bytes=A-B", they send A to the end of
 * the file. aria2 rejects that ("Invalid range header") whenever it resumes a file with gaps, because then it asks
 * for exact slices. Downloads from such hosts go through here instead: the relay forwards the request with the
 * link's headers and trims the reply to the slice aria2 asked for.
 */
export class RangeProxy {
  private server: Server | null = null
  private port = 0
  private readonly targets = new Map<string, Target>()
  private readonly hosts = new Set<string>()

  async start(): Promise<void> {
    if (this.server) return
    const server = createServer((req, res) => void this.handle(req, res))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    this.port = typeof address === 'object' && address ? address.port : 0
    this.server = server
    log.info(`[range-proxy] listening on 127.0.0.1:${this.port}`)
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  /** Routes this host's downloads through the relay from now on. */
  markHost(url: string): void {
    const host = hostOf(url)
    if (host) this.hosts.add(host)
  }

  handles(url: string): boolean {
    return this.hosts.has(hostOf(url))
  }

  /** Registers a download and returns the local URL aria2 should fetch instead of the host's. */
  urlFor(linkId: number, url: string, headers: Record<string, string>, filename: string | null): string {
    this.release(linkId)
    const token = `${linkId}-${randomBytes(12).toString('hex')}`
    this.targets.set(token, { url, headers })
    return `http://127.0.0.1:${this.port}/f/${token}/${encodeURIComponent(filename ?? 'download')}`
  }

  release(linkId: number): void {
    for (const token of this.targets.keys()) if (token.startsWith(`${linkId}-`)) this.targets.delete(token)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = (req.url ?? '').split('/')[2] ?? ''
    const target = this.targets.get(token)
    if (!target || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(404)
      res.end()
      return
    }

    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
    const start = range ? Number(range[1]) : null
    const end = range && range[2] ? Number(range[2]) : null

    const upstreamAbort = new AbortController()
    res.on('close', () => upstreamAbort.abort())

    let upstream: Response
    try {
      upstream = await fetch(target.url, {
        method: req.method,
        headers: { ...target.headers, 'Accept-Encoding': 'identity', ...(range ? { Range: range[0] } : {}) },
        redirect: 'follow',
        signal: upstreamAbort.signal
      })
    } catch (err) {
      if (!upstreamAbort.signal.aborted) log.warn(`[range-proxy] upstream request failed for ${hostOf(target.url)}`, err)
      if (!res.headersSent) res.writeHead(502)
      res.end()
      return
    }

    const headers: Record<string, string> = {}
    for (const name of PASS_HEADERS) {
      const value = upstream.headers.get(name)
      if (value) headers[name] = value
    }

    let limit: number | null = null
    const sent = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(upstream.headers.get('content-range') ?? '')
    if (upstream.status === 206 && sent && end !== null && Number(sent[1]) === start && Number(sent[2]) > end) {
      // The host ignored the range end; answer with exactly the slice that was asked for.
      limit = end - Number(sent[1]) + 1
      headers['content-range'] = `bytes ${sent[1]}-${end}/${sent[3]}`
      headers['content-length'] = String(limit)
    } else {
      const contentRange = upstream.headers.get('content-range')
      const contentLength = upstream.headers.get('content-length')
      if (contentRange) headers['content-range'] = contentRange
      if (contentLength) headers['content-length'] = contentLength
    }

    res.writeHead(upstream.status, headers)
    if (req.method === 'HEAD' || !upstream.body) {
      res.end()
      upstreamAbort.abort()
      return
    }

    const body = Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>)
    body.on('error', () => res.destroy())
    if (limit === null) {
      body.pipe(res)
      return
    }

    let remaining = limit
    res.on('drain', () => body.resume())
    body.on('end', () => res.end())
    body.on('data', (chunk: Buffer) => {
      if (remaining <= 0) return
      const piece = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk
      remaining -= piece.length
      const flushed = res.write(piece)
      if (remaining <= 0) {
        res.end()
        body.destroy()
        upstreamAbort.abort()
      } else if (!flushed) {
        body.pause()
      }
    })
  }
}
