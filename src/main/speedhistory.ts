import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import log from 'electron-log/main'
import type { SpeedSeries } from '../shared/types'

/** Two hours of one-second samples: enough for every view up to 1 h at full detail. */
const SECONDS = 2 * 60 * 60
/** A day of one-minute averages, for the 6 h and 24 h views. 1,440 numbers. */
const MINUTES = 24 * 60
/** Saved days kept on disk when saving is on; older files are deleted. */
const KEEP_DAYS = 30

/** One ring of samples keyed by a time index (a second or a minute), which knows which slots are current. */
class Ring {
  private readonly values: Float64Array
  /** The time index each slot holds, so a slot left over from a previous lap of the ring reads as empty. */
  private readonly stamps: Float64Array

  constructor(readonly size: number) {
    this.values = new Float64Array(size)
    this.stamps = new Float64Array(size).fill(-1)
  }

  set(t: number, v: number): void {
    this.values[t % this.size] = v
    this.stamps[t % this.size] = t
  }

  get(t: number): number | null {
    const slot = ((t % this.size) + this.size) % this.size
    return this.stamps[slot] === t ? this.values[slot] : null
  }

  /** Average of the samples in [from, to), or null when there are none. */
  average(from: number, to: number): number | null {
    let sum = 0
    let n = 0
    for (let t = from; t < to; t++) {
      const v = this.get(t)
      if (v === null) continue
      sum += v
      n++
    }
    return n ? sum / n : null
  }
}

const localDate = (epochSec: number): string => {
  const d = new Date(epochSec * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Rolling record of total download speed for the Downloads page's chart.
 *
 * It lives in the main process because the renderer's views come and go — a chart that kept its own samples
 * would start empty every time the page was opened. Samples are taken once a second; each finished minute is
 * also averaged into a coarser ring so the 6 h and 24 h views don't need a day of seconds.
 *
 * Nothing survives a restart unless the user turns on saving, in which case each finished minute is appended to
 * a per-day file under `dir` on their own PC, and past days can be read back.
 */
export class SpeedHistory {
  private readonly seconds = new Ring(SECONDS)
  private readonly minutes = new Ring(MINUTES)
  private timer: NodeJS.Timeout | null = null
  private lastSecond = -1
  private lastMinute = -1

  constructor(
    private readonly read: () => { speed: number; limit: number; save: boolean },
    private readonly dir: string
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.sample(), 1000)
    void this.prune()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private sample(): void {
    const now = Math.floor(Date.now() / 1000)
    const speed = Math.max(0, this.read().speed)
    // setInterval drifts, so now and then two ticks land in one second and the next second gets none. Left
    // empty, that second would read as 0 and draw a false drop to zero mid-download; fill it with this reading.
    // Longer gaps (the machine slept) stay empty.
    const from = this.lastSecond >= 0 && now - this.lastSecond <= 3 ? this.lastSecond + 1 : now
    for (let s = from; s <= now; s++) this.seconds.set(s, speed)
    this.lastSecond = now

    const minute = Math.floor(now / 60)
    if (this.lastMinute >= 0 && minute !== this.lastMinute) this.finishMinute(this.lastMinute)
    this.lastMinute = minute
  }

  /** A minute has passed: fold its seconds into the minute ring, and save it if the user asked for that. */
  private finishMinute(minute: number): void {
    const avg = this.seconds.average(minute * 60, minute * 60 + 60)
    if (avg === null) return
    this.minutes.set(minute, avg)
    if (this.read().save) void this.append(minute, avg)
  }

  private async append(minute: number, bps: number): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true })
      await appendFile(join(this.dir, `${localDate(minute * 60)}.csv`), `${minute * 60},${Math.round(bps)}\n`, 'utf8')
    } catch (err) {
      log.warn('[speed] could not save speed history', err)
    }
  }

  /** Deletes saved days older than KEEP_DAYS, so leaving saving on can't slowly fill the disk. */
  private async prune(): Promise<void> {
    const days = await this.savedDays()
    for (const day of days.slice(KEEP_DAYS)) await rm(join(this.dir, `${day}.csv`), { force: true }).catch(() => {})
  }

  /**
   * `points` buckets of `step` seconds each, oldest first, ending with the bucket that holds now. Buckets are
   * aligned to the wall clock rather than to the request, so the line shifts one step at a time instead of
   * jittering as it's polled. Steps of a minute or more read the minute ring, plus the minute in progress.
   */
  series(step: number, points: number): SpeedSeries {
    const stepSec = Math.max(1, Math.round(step))
    const coarse = stepSec >= 60 && stepSec % 60 === 0
    const reach = coarse ? MINUTES * 60 : SECONDS
    const count = Math.max(2, Math.min(Math.round(points), Math.floor(reach / stepSec)))
    // "Now" is the last second actually sampled. The current second usually hasn't been yet, and counting it
    // would end every line with a false drop to zero.
    const now = this.lastSecond >= 0 ? this.lastSecond : Math.floor(Date.now() / 1000)
    const end = now - (now % stepSec)
    const values: number[] = []
    for (let b = end - (count - 1) * stepSec; b <= end; b += stepSec) {
      let avg: number | null
      if (coarse) {
        // Minutes already folded, plus the current minute straight from the seconds ring.
        const current = Math.floor(now / 60)
        let sum = 0
        let n = 0
        for (let m = b / 60; m < (b + stepSec) / 60; m++) {
          const v = m === current ? this.seconds.average(m * 60, now + 1) : this.minutes.get(m)
          if (v === null) continue
          sum += v
          n++
        }
        avg = n ? sum / n : null
      } else {
        avg = this.seconds.average(b, Math.min(b + stepSec, now + 1))
      }
      // No samples (before the app started) is 0: nothing was downloading through Waypoint then.
      values.push(avg ?? 0)
    }
    return { step: stepSec, end, values, limit: this.read().limit }
  }

  /** Saved days, newest first, as YYYY-MM-DD. */
  async savedDays(): Promise<string[]> {
    const names = await readdir(this.dir).catch(() => [] as string[])
    return names
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.csv$/.test(n))
      .map((n) => n.slice(0, 10))
      .sort()
      .reverse()
  }

  /**
   * A saved day as 1,440 one-minute points from local midnight. Minutes with nothing saved — Waypoint wasn't
   * running — are flagged in `gaps`, so the chart leaves a gap rather than drawing a misleading zero.
   */
  async day(date: string): Promise<SpeedSeries & { gaps: boolean[] }> {
    const [y, mo, d] = date.split('-').map(Number)
    const start = Math.floor(new Date(y, mo - 1, d).getTime() / 1000)
    const values = new Array<number>(MINUTES).fill(0)
    const gaps = new Array<boolean>(MINUTES).fill(true)
    const text = /^\d{4}-\d{2}-\d{2}$/.test(date) ? await readFile(join(this.dir, `${date}.csv`), 'utf8').catch(() => '') : ''
    for (const line of text.split('\n')) {
      const [t, v] = line.split(',').map(Number)
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue
      const i = Math.floor((t - start) / 60)
      if (i < 0 || i >= MINUTES) continue
      values[i] = v
      gaps[i] = false
    }
    return { step: 60, end: start + (MINUTES - 1) * 60, values, limit: 0, gaps }
  }
}
