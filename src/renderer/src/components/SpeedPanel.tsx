import { useEffect, useRef, useState } from 'react'
import type { WaypointApi } from '@shared/api'
import type { SpeedSeries } from '@shared/types'
import { formatSpeed } from '../lib/format'
import { Icon } from './Icons'

/**
 * The buttons say how far back the chart goes. Each picks, behind the scenes, how many seconds one point
 * averages so the line stays between ~180 and 300 points. 6 h and 24 h read the main process's minute ring.
 */
const RANGES = [
  { id: '5m', label: '5m', title: 'Last 5 minutes', step: 1, points: 300 },
  { id: '30m', label: '30m', title: 'Last 30 minutes', step: 10, points: 180 },
  { id: '1h', label: '1h', title: 'Last hour', step: 20, points: 180 },
  { id: '6h', label: '6h', title: 'Last 6 hours', step: 120, points: 180 },
  { id: '24h', label: '24h', title: 'Last 24 hours', step: 480, points: 180 }
] as const
type RangeId = (typeof RANGES)[number]['id']

const HEIGHT = 150
const PAD = { top: 10, right: 12, bottom: 22, left: 64 }
const LIVE = 'live'

const STORE_KEY = 'waypoint.speedPanel'

/** Per-viewer convenience only; storage can be missing or throw, and the panel works the same without it. */
function loadPrefs(): { open: boolean; range: RangeId } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as { open?: boolean; range?: string }
    const range = RANGES.find((r) => r.id === saved.range)?.id ?? '5m'
    return { open: saved.open ?? true, range }
  } catch {
    return { open: true, range: '5m' }
  }
}

function savePrefs(prefs: { open: boolean; range: RangeId }): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs))
  } catch {
    // not worth surfacing
  }
}

const KB = 1024
const MB = 1024 * 1024

/**
 * Gridline spacing for four gridlines, in whichever unit the peak reads best in. The steps are finer than the
 * usual 1/2/5 so the top gridline sits just above the peak rather than leaving the upper half of the chart empty.
 */
function niceTick(peak: number): number {
  const unit = peak >= MB ? MB : KB
  const raw = Math.max(peak / 4, unit * 0.1) / unit
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * pow >= raw) ?? 10
  return step * pow * unit
}

/** Axis label in the gridlines' own unit, so the scale never mixes "614 KB/s" with "1.2 MB/s". */
function axisLabel(bps: number, tick: number): string {
  const unit = tick >= MB * 0.1 ? MB : KB
  const n = bps / unit
  return `${Number.isInteger(n) ? n : n.toFixed(n < 10 ? 1 : 0)} ${unit === MB ? 'MB/s' : 'KB/s'}`
}

function span(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return s ? `${m}m ${s}s` : `${m}m`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

/** Time gridlines at round offsets from now (every 1m, 10m, 1h…), about four across the window. */
const TIME_STEPS = [10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600]
function timeTicks(windowSec: number): number[] {
  const every = TIME_STEPS.find((t) => windowSec / t <= 5) ?? 21600
  const ticks: number[] = []
  for (let ago = 0; ago <= windowSec; ago += every) ticks.push(ago)
  return ticks
}

const clock = (epochSec: number, seconds = true): string =>
  new Date(epochSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) })

const dayLabel = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number)
  const when = new Date(y, m - 1, d)
  const today = new Date()
  if (when.toDateString() === today.toDateString()) return 'Today (saved)'
  return when.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Runs of consecutive points that have data, so a gap (Waypoint not running) breaks the line. */
function segments(count: number, isGap: (i: number) => boolean): [number, number][] {
  const runs: [number, number][] = []
  let start = -1
  for (let i = 0; i <= count; i++) {
    const gap = i === count || isGap(i)
    if (!gap && start < 0) start = i
    if (gap && start >= 0) {
      runs.push([start, i - 1])
      start = -1
    }
  }
  return runs
}

interface Props {
  api: WaypointApi
  speedNow: number
  /** Settings.saveSpeedHistory — when on, saved days can be picked from the header. */
  savingHistory: boolean
}

/**
 * Download speed over time, docked under the download list the way desktop torrent clients do it. The live
 * history is kept by the main process (see SpeedHistory), so the chart is already full when the page opens; this
 * component only asks for the range on screen, once a second, while it's expanded. With saving on, a past day
 * can be opened from the files kept on this PC.
 */
export function SpeedPanel({ api, speedNow, savingHistory }: Props) {
  const [prefs, setPrefs] = useState(loadPrefs)
  const [source, setSource] = useState<string>(LIVE)
  const [days, setDays] = useState<string[]>([])
  const [series, setSeries] = useState<SpeedSeries | null>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const range = RANGES.find((r) => r.id === prefs.range) ?? RANGES[0]
  const live = source === LIVE

  const update = (next: Partial<typeof prefs>) => {
    const merged = { ...prefs, ...next }
    setPrefs(merged)
    savePrefs(merged)
  }

  // The list of saved days, refreshed when the panel opens or saving is switched on.
  useEffect(() => {
    if (!prefs.open || !savingHistory) {
      setDays([])
      setSource(LIVE)
      return
    }
    void api.speedDays().then(setDays).catch(() => setDays([]))
  }, [api, prefs.open, savingHistory])

  useEffect(() => {
    if (!prefs.open) return
    let alive = true
    setHover(null)
    if (!live) {
      void api.speedDay(source).then((s) => alive && setSeries(s)).catch(() => {})
      return () => {
        alive = false
      }
    }
    const load = () => void api.speedHistory(range.step, range.points).then((s) => alive && setSeries(s)).catch(() => {})
    load()
    const timer = setInterval(load, 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [api, prefs.open, range.step, range.points, live, source])

  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [prefs.open])

  const values = series?.values ?? []
  const gaps = series?.gaps
  const isGap = (i: number) => !!gaps?.[i]
  const recorded = values.filter((_, i) => !isGap(i))
  const peak = recorded.length ? Math.max(...recorded) : 0
  const active = recorded.filter((v) => v > 0)
  const average = active.length ? active.reduce((a, b) => a + b, 0) / active.length : 0
  const limit = live ? (series?.limit ?? 0) : 0
  // The cap only earns a line when it's in the same range as the traffic; a far-off cap would flatten the data.
  const showLimit = limit > 0 && limit <= Math.max(peak, 1) * 3
  const tick = niceTick(Math.max(peak, showLimit ? limit : 0, 64 * KB))
  const yMax = tick * 4

  const plotW = Math.max(0, width - PAD.left - PAD.right)
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (values.length > 1 ? (i / (values.length - 1)) * plotW : 0)
  const y = (v: number) => PAD.top + plotH - (Math.min(v, yMax) / yMax) * plotH
  const runs = segments(values.length, isGap)
  const pointsOf = ([a, b]: [number, number]) =>
    values
      .slice(a, b + 1)
      .map((v, k) => `${x(a + k).toFixed(1)},${y(v).toFixed(1)}`)
      .join(' ')

  const windowSec = series ? series.step * (values.length - 1) : range.step * (range.points - 1)
  const xTicks = live
    ? timeTicks(windowSec).map((ago) => ({ f: 1 - ago / windowSec, label: ago === 0 ? 'now' : `${span(ago)} ago` }))
    : [0, 6, 12, 18, 24].map((h) => ({ f: h / 24, label: `${String(h).padStart(2, '0')}:00` }))

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (values.length < 2 || plotW <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left - PAD.left
    if (px < -8 || px > plotW + 8) return setHover(null)
    setHover(Math.max(0, Math.min(values.length - 1, Math.round((px / plotW) * (values.length - 1)))))
  }

  const hovered =
    hover !== null && series ? { v: values[hover], gap: isGap(hover), t: series.end - (values.length - 1 - hover) * series.step } : null

  return (
    <section className={`card speed-panel ${prefs.open ? 'open' : ''}`}>
      <header className="speed-panel-head">
        <button className="speed-panel-toggle" onClick={() => update({ open: !prefs.open })} aria-expanded={prefs.open}>
          <Icon name="chevronRight" size={16} className="chevron" />
          <span className="speed-panel-title">Speed</span>
        </button>
        <div className="speed-panel-stats">
          <span>
            <small>Now</small>
            <strong>{formatSpeed(speedNow)}</strong>
          </span>
          {prefs.open && (
            <>
              <span>
                <small>Average</small>
                <strong>{formatSpeed(average)}</strong>
              </span>
              <span>
                <small>Peak</small>
                <strong>{formatSpeed(peak)}</strong>
              </span>
            </>
          )}
        </div>
        <span className="spacer" />
        {prefs.open && savingHistory && (
          <select className="input speed-day" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Show">
            <option value={LIVE}>Live</option>
            {days.map((d) => (
              <option key={d} value={d}>
                {dayLabel(d)}
              </option>
            ))}
          </select>
        )}
        {prefs.open && live && (
          <div className="segmented small" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r.id} className={prefs.range === r.id ? 'active' : ''} onClick={() => update({ range: r.id })} title={r.title}>
                {r.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {prefs.open && (
        <div className="speed-plot" ref={plotRef}>
          {width > 0 && (
            <svg width={width} height={HEIGHT} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Download speed over time">
              <defs>
                <linearGradient id="speed-panel-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--primary)" stopOpacity="0.22" />
                  <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
                </linearGradient>
              </defs>

              {[0, 1, 2, 3, 4].map((k) => (
                <g key={k}>
                  <line className="speed-grid" x1={PAD.left} x2={PAD.left + plotW} y1={y(tick * k)} y2={y(tick * k)} />
                  <text className="speed-axis" x={PAD.left - 8} y={y(tick * k)} dy="0.32em" textAnchor="end">
                    {k === 0 ? '0' : axisLabel(tick * k, tick)}
                  </text>
                </g>
              ))}
              {xTicks.map(({ f, label }) => (
                <text key={f} className="speed-axis" x={PAD.left + f * plotW} y={HEIGHT - 6} textAnchor={f < 0.04 ? 'start' : f === 1 ? 'end' : 'middle'}>
                  {label}
                </text>
              ))}

              {showLimit && (
                <g>
                  <line className="speed-limit" x1={PAD.left} x2={PAD.left + plotW} y1={y(limit)} y2={y(limit)} />
                  <text className="speed-axis" x={PAD.left + plotW} y={y(limit) - 4} textAnchor="end">
                    limit {formatSpeed(limit)}
                  </text>
                </g>
              )}

              {runs.map((run) => (
                <g key={run[0]}>
                  <polygon points={`${x(run[0])},${y(0)} ${pointsOf(run)} ${x(run[1])},${y(0)}`} fill="url(#speed-panel-fill)" />
                  <polyline points={pointsOf(run)} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                </g>
              ))}
              {!live && runs.length === 0 && (
                <text className="speed-axis" x={PAD.left + plotW / 2} y={PAD.top + plotH / 2} textAnchor="middle">
                  Nothing saved for this day
                </text>
              )}

              {hovered && hover !== null && (
                <g pointerEvents="none">
                  <line className="speed-crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} />
                  {!hovered.gap && <circle cx={x(hover)} cy={y(hovered.v)} r="4" fill="var(--primary)" stroke="var(--card)" strokeWidth="2" />}
                </g>
              )}
            </svg>
          )}
          {hovered && hover !== null && (
            // Beside the crosshair, never over it, so the stretch of line being read stays visible.
            <div
              className={`speed-tip ${x(hover) > PAD.left + plotW / 2 ? 'left' : 'right'}`}
              style={{ left: x(hover), top: PAD.top }}
            >
              <strong>{hovered.gap ? 'Waypoint not running' : hovered.v > 0 ? formatSpeed(hovered.v) : 'idle'}</strong>
              <span>
                {clock(hovered.t, live && series !== null && series.step < 60)}
                {series && series.step > 1 && !hovered.gap ? ` · ${span(series.step)} avg` : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
