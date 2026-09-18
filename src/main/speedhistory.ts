import type { SpeedSeries } from '../shared/types'

/** Seconds of per-second history kept. The coarsest view (1 min x 120 points) needs exactly this much. */
const WINDOW_SEC = 2 * 60 * 60

/**
 * Rolling record of total download speed, one sample a second, for the Downloads page's speed chart.
 *
 * It lives in the main process because the renderer's views come and go — a chart that kept its own samples
 * would start empty every time the page was opened, and couldn't show the last hour of a long batch. A ring of
 * two hours of seconds is 7200 numbers; views at coarser resolutions average it on request.
 */
export class SpeedHistory {
  private readonly values = new Float64Array(WINDOW_SEC)
  /** The epoch second each slot holds, so a slot left over from a previous lap of the ring reads as empty. */
  private readonly stamps = new Float64Array(WINDOW_SEC).fill(-1)
  private timer: NodeJS.Timeout | null = null
  private lastSecond = -1

  constructor(private readonly read: () => { speed: number; limit: number }) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.sample(), 1000)
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
    for (let s = from; s <= now; s++) {
      this.values[s % WINDOW_SEC] = speed
      this.stamps[s % WINDOW_SEC] = s
    }
    this.lastSecond = now
  }

  /**
   * `points` buckets of `step` seconds each, oldest first, ending with the bucket that holds now. Buckets are
   * aligned to the wall clock rather than to the request, so the line shifts one step at a time instead of
   * jittering as it's polled.
   */
  series(step: number, points: number): SpeedSeries {
    const stepSec = Math.max(1, Math.round(step))
    const count = Math.max(2, Math.min(Math.round(points), Math.floor(WINDOW_SEC / stepSec)))
    const now = Math.floor(Date.now() / 1000)
    const end = now - (now % stepSec)
    const values: number[] = []
    for (let b = end - (count - 1) * stepSec; b <= end; b += stepSec) {
      let sum = 0
      let n = 0
      for (let s = b; s < b + stepSec && s <= now; s++) {
        const slot = ((s % WINDOW_SEC) + WINDOW_SEC) % WINDOW_SEC
        if (this.stamps[slot] !== s) continue
        sum += this.values[slot]
        n++
      }
      // No samples at all (before the app started) is 0 too: nothing was downloading through Waypoint then.
      values.push(n ? sum / n : 0)
    }
    return { step: stepSec, end, values, limit: this.read().limit }
  }
}
