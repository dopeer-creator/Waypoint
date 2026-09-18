import { useEffect, useRef, useState } from 'react'
import type { WaypointApi } from '@shared/api'
import type { SpeedSeries } from '@shared/types'
import { formatSpeed } from '../lib/format'
import { Icon } from './Icons'

/** Seconds per point. 120 points each: the last 2 minutes, 10 minutes, 1 hour, or 2 hours. */
const RESOLUTIONS = [1, 5, 30, 60] as const
type Resolution = (typeof RESOLUTIONS)[number]
const POINTS = 120
const HEIGHT = 150
const PAD = { top: 10, right: 12, bottom: 22, left: 64 }

const STORE_KEY = 'waypoint.speedPanel'

/** Per-viewer convenience only; storage can be missing or throw, and the panel works the same without it. */
function loadPrefs(): { open: boolean; step: Resolution } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as { open?: boolean; step?: number }
    const step = RESOLUTIONS.find((r) => r === saved.step) ?? 1
    return { open: saved.open ?? true, step }
  } catch {
    return { open: true, step: 1 }
  }
}

function savePrefs(prefs: { open: boolean; step: Resolution }): void {
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

/** Time gridlines at round offsets from now (every 30s, 2m, 15m…), about four across the window. */
const TIME_STEPS = [10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
function timeTicks(windowSec: number): number[] {
  const every = TIME_STEPS.find((t) => windowSec / t <= 5) ?? 3600
  const ticks: number[] = []
  for (let ago = 0; ago <= windowSec; ago += every) ticks.push(ago)
  return ticks
}

const clock = (epochSec: number): string =>
  new Date(epochSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * Download speed over time, docked under the download list the way desktop torrent clients do it. History is
 * kept by the main process (see SpeedHistory), so the chart is already full when the page opens and can span
 * hours; this component only asks for the resolution on screen, once a second, while it's expanded.
 */
export function SpeedPanel({ api, speedNow }: { api: WaypointApi; speedNow: number }) {
  const [prefs, setPrefs] = useState(loadPrefs)
  const [series, setSeries] = useState<SpeedSeries | null>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)

  const update = (next: Partial<typeof prefs>) => {
    const merged = { ...prefs, ...next }
    setPrefs(merged)
    savePrefs(merged)
  }

  useEffect(() => {
    if (!prefs.open) return
    let alive = true
    const load = () => void api.speedHistory(prefs.step, POINTS).then((s) => alive && setSeries(s)).catch(() => {})
    load()
    const timer = setInterval(load, 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [api, prefs.open, prefs.step])

  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [prefs.open])

  const values = series?.values ?? []
  const peak = values.length ? Math.max(...values) : 0
  const active = values.filter((v) => v > 0)
  const average = active.length ? active.reduce((a, b) => a + b, 0) / active.length : 0
  const limit = series?.limit ?? 0
  // The cap only earns a line when it's in the same range as the traffic; a far-off cap would flatten the data.
  const showLimit = limit > 0 && limit <= Math.max(peak, 1) * 3
  const tick = niceTick(Math.max(peak, showLimit ? limit : 0, 64 * KB))
  const yMax = tick * 4

  const plotW = Math.max(0, width - PAD.left - PAD.right)
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (values.length > 1 ? (i / (values.length - 1)) * plotW : 0)
  const y = (v: number) => PAD.top + plotH - (Math.min(v, yMax) / yMax) * plotH
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = values.length ? `${x(0)},${y(0)} ${line} ${x(values.length - 1)},${y(0)}` : ''

  const windowSec = (prefs.step * (POINTS - 1)) as number
  const xTicks = timeTicks(windowSec).map((ago) => ({ f: 1 - ago / windowSec, label: ago === 0 ? 'now' : `${span(ago)} ago` }))

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (values.length < 2 || plotW <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left - PAD.left
    if (px < -8 || px > plotW + 8) return setHover(null)
    setHover(Math.max(0, Math.min(values.length - 1, Math.round((px / plotW) * (values.length - 1)))))
  }

  const hovered = hover !== null && series ? { v: values[hover], t: series.end - (values.length - 1 - hover) * series.step } : null

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
        {prefs.open && (
          <div className="segmented small" role="group" aria-label="Resolution">
            {RESOLUTIONS.map((r) => (
              <button key={r} className={prefs.step === r ? 'active' : ''} onClick={() => update({ step: r })} title={`${r}s per point — last ${span(r * (POINTS - 1))}`}>
                {r < 60 ? `${r}s` : '1m'}
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
                    {k === 0 ? '0' : formatSpeed(tick * k)}
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

              {values.length > 1 && (
                <>
                  <polygon points={area} fill="url(#speed-panel-fill)" />
                  <polyline points={line} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                </>
              )}

              {hovered && hover !== null && (
                <g pointerEvents="none">
                  <line className="speed-crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} />
                  <circle cx={x(hover)} cy={y(hovered.v)} r="4" fill="var(--primary)" stroke="var(--card)" strokeWidth="2" />
                </g>
              )}
            </svg>
          )}
          {hovered && hover !== null && (
            <div className="speed-tip" style={{ left: Math.min(Math.max(x(hover), PAD.left + 60), PAD.left + plotW - 60), top: PAD.top }}>
              <strong>{hovered.v > 0 ? formatSpeed(hovered.v) : 'idle'}</strong>
              <span>
                {clock(hovered.t)}
                {series && series.step > 1 ? ` · ${series.step}s avg` : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
