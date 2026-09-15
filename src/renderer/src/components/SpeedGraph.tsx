import { useEffect, useRef, useState } from 'react'
import { formatSpeed } from '../lib/format'

const SAMPLES = 64

/** Rolling area chart of total download speed. Fed the current speed each snapshot. */
export function SpeedGraph({ speed }: { speed: number }) {
  const [history, setHistory] = useState<number[]>(() => new Array(SAMPLES).fill(0))
  const last = useRef(0)

  useEffect(() => {
    // Throttle to ~2 samples/sec so the line advances steadily regardless of snapshot cadence.
    const t = setInterval(() => {
      setHistory((h) => [...h.slice(1), last.current])
    }, 500)
    return () => clearInterval(t)
  }, [])
  last.current = speed

  const w = 132
  const h = 40
  const peak = Math.max(1, ...history)
  const step = w / (SAMPLES - 1)
  const y = (v: number) => h - (v / peak) * (h - 4) - 2
  const line = history.map((v, i) => `${i * step},${y(v)}`).join(' ')
  const area = `0,${h} ${line} ${w},${h}`

  return (
    <div className="speed-graph" title="Download speed">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="sg-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--primary)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#sg-fill)" />
        <polyline points={line} fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <div className="speed-graph-label">
        <span className="speed-graph-now">{formatSpeed(speed)}</span>
        <span className="speed-graph-peak">peak {formatSpeed(peak > 1 ? peak : 0)}</span>
      </div>
    </div>
  )
}
