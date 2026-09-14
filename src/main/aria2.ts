import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'
import log from 'electron-log/main'

export type Aria2State = 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed'

export interface Aria2Status {
  gid: string
  status: Aria2State
  totalLength: string
  completedLength: string
  downloadSpeed: string
  errorCode?: string
  errorMessage?: string
  files?: { path: string }[]
}

export class Aria2Error extends Error {
  constructor(
    message: string,
    readonly code?: number
  ) {
    super(message)
  }
}

export interface Aria2StartOptions {
  maxConcurrent: number
  speedLimitKib: number
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Owns the aria2c child process and talks to it over localhost JSON-RPC with a per-launch secret. */
export class Aria2 extends EventEmitter {
  private proc: ChildProcess | null = null
  private port = 0
  private readonly secret = randomBytes(24).toString('hex')
  private requestId = 0
  private stopping = false
  version: string | null = null

  constructor(private readonly exePath: string) {
    super()
  }

  get ready(): boolean {
    return this.proc !== null && this.version !== null
  }

  async start(options: Aria2StartOptions): Promise<void> {
    if (this.proc) return
    this.stopping = false
    this.port = await freePort()

    const args = [
      '--enable-rpc=true',
      `--rpc-listen-port=${this.port}`,
      '--rpc-listen-all=false',
      `--rpc-secret=${this.secret}`,
      '--rpc-max-request-size=16M',
      `--stop-with-process=${process.pid}`,
      `--max-concurrent-downloads=${options.maxConcurrent}`,
      `--max-overall-download-limit=${options.speedLimitKib > 0 ? `${options.speedLimitKib}K` : '0'}`,
      '--continue=true',
      '--auto-file-renaming=false',
      '--allow-overwrite=false',
      '--file-allocation=none',
      '--min-split-size=1M',
      '--max-tries=5',
      '--retry-wait=5',
      '--timeout=60',
      '--connect-timeout=30',
      '--disk-cache=32M',
      '--max-download-result=1000',
      '--enable-dht=false',
      '--follow-torrent=false',
      '--summary-interval=0',
      '--console-log-level=warn'
    ]

    log.info(`[aria2] starting ${this.exePath} on port ${this.port}`)
    const proc = spawn(this.exePath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = proc
    // aria2 prints blank progress lines on stdout; only keep lines with content.
    const logLines = (write: (msg: string) => void) => (d: Buffer) => {
      for (const line of d.toString().split(/\r?\n/)) if (line.trim()) write(`[aria2] ${line.trim()}`)
    }
    proc.stdout?.on('data', logLines((m) => log.info(m)))
    proc.stderr?.on('data', logLines((m) => log.warn(m)))
    proc.on('error', (err) => log.error('[aria2] process error', err))
    proc.on('exit', (code) => {
      log.info(`[aria2] exited with code ${code}`)
      this.proc = null
      this.version = null
      if (!this.stopping) this.emit('crashed', code)
    })

    for (let i = 0; i < 50; i++) {
      if (!this.proc) throw new Aria2Error('aria2c exited during startup — see logs')
      try {
        const info = await this.call<{ version: string }>('aria2.getVersion')
        this.version = info.version
        log.info(`[aria2] ready, version ${info.version}`)
        return
      } catch {
        await sleep(200)
      }
    }
    throw new Aria2Error('aria2c did not answer RPC within 10 seconds')
  }

  async stop(): Promise<void> {
    if (!this.proc) return
    this.stopping = true
    const proc = this.proc
    try {
      await Promise.race([this.call('aria2.forceShutdown'), sleep(2000)])
    } catch {
      // Already gone.
    }
    await sleep(300)
    if (!proc.killed && proc.exitCode === null) proc.kill()
    this.proc = null
    this.version = null
  }

  async call<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
    const res = await fetch(`http://127.0.0.1:${this.port}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: String(++this.requestId),
        method,
        params: [`token:${this.secret}`, ...params]
      })
    })
    const body = (await res.json()) as { result?: T; error?: { code: number; message: string } }
    if (body.error) throw new Aria2Error(body.error.message, body.error.code)
    return body.result as T
  }

  /** Runs several calls in one request. Failed entries come back as Aria2Error instances. */
  async multicall<T = unknown>(calls: [method: string, ...params: unknown[]][]): Promise<(T | Aria2Error)[]> {
    if (!calls.length) return []
    const payload = calls.map(([methodName, ...params]) => ({
      methodName,
      params: [`token:${this.secret}`, ...params]
    }))
    const results = await this.callRaw<unknown[]>('system.multicall', [payload])
    return results.map((entry) =>
      Array.isArray(entry)
        ? (entry[0] as T)
        : new Aria2Error((entry as { message: string }).message, (entry as { code: number }).code)
    )
  }

  /** system.multicall must not carry the token at the top level. */
  private async callRaw<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(`http://127.0.0.1:${this.port}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: String(++this.requestId), method, params })
    })
    const body = (await res.json()) as { result?: T; error?: { code: number; message: string } }
    if (body.error) throw new Aria2Error(body.error.message, body.error.code)
    return body.result as T
  }

  addUri(url: string, options: Record<string, string | string[]>): Promise<string> {
    return this.call<string>('aria2.addUri', [url], options)
  }

  async tellStatuses(gids: string[]): Promise<(Aria2Status | Aria2Error)[]> {
    const keys = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorCode', 'errorMessage', 'files']
    return this.multicall<Aria2Status>(gids.map((gid) => ['aria2.tellStatus', gid, keys]))
  }

  async pause(gid: string): Promise<void> {
    await this.call('aria2.forcePause', gid).catch(() => undefined)
  }

  async unpause(gid: string): Promise<void> {
    await this.call('aria2.unpause', gid).catch(() => undefined)
  }

  /** Stops a download and forgets it. Partial files and .aria2 control files stay on disk for later resume. */
  async remove(gid: string): Promise<void> {
    await this.call('aria2.forceRemove', gid).catch(() => undefined)
    await sleep(100)
    await this.call('aria2.removeDownloadResult', gid).catch(() => undefined)
  }

  async setGlobal(options: Partial<Aria2StartOptions>): Promise<void> {
    const out: Record<string, string> = {}
    if (options.maxConcurrent !== undefined) out['max-concurrent-downloads'] = String(options.maxConcurrent)
    if (options.speedLimitKib !== undefined)
      out['max-overall-download-limit'] = options.speedLimitKib > 0 ? `${options.speedLimitKib}K` : '0'
    if (this.ready && Object.keys(out).length) await this.call('aria2.changeGlobalOption', out)
  }
}
