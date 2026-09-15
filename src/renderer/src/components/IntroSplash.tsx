import { useEffect, useState } from 'react'
import { Wordmark } from './Brand'

const FULL_MS = 2600
const REDUCED_MS = 700

/**
 * One-time launch animation: the Waypoint mark's parts ease in and converge to form the logo, hold, then break
 * apart and fade to reveal the app. Honours prefers-reduced-motion (a short fade instead). Calls onDone when gone.
 */
export function IntroSplash({ onDone }: { onDone: () => void }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const total = reduced ? REDUCED_MS : FULL_MS
    const fade = setTimeout(() => setLeaving(true), total - 350)
    const done = setTimeout(onDone, total)
    return () => {
      clearTimeout(fade)
      clearTimeout(done)
    }
  }, [onDone, reduced])

  return (
    <div className={`intro ${reduced ? 'reduced' : ''} ${leaving ? 'leaving' : ''}`} aria-hidden>
      <div className="intro-logo">
        <svg className="intro-mark" viewBox="588 211 360 360" width="132" height="132">
          <defs>
            <linearGradient id="intro-l" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--mark-l1)' }} />
              <stop offset="1" style={{ stopColor: 'var(--mark-l2)' }} />
            </linearGradient>
            <linearGradient id="intro-r" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--mark-r1)' }} />
              <stop offset="1" style={{ stopColor: 'var(--mark-r2)' }} />
            </linearGradient>
            <linearGradient id="intro-a" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--mark-arc1)' }} />
              <stop offset="1" style={{ stopColor: 'var(--mark-arc2)' }} />
            </linearGradient>
          </defs>
          <path className="p-arcL" d="M722 269.5A167 167 0 0 0 606.7 473.2" fill="none" stroke="url(#intro-a)" strokeWidth="9" />
          <path className="p-arcR" d="M814 269.5A167 167 0 0 1 929.3 473.2" fill="none" stroke="url(#intro-a)" strokeWidth="9" />
          <path className="p-bladeL" d="M768 222L603 552L768 395Z" fill="url(#intro-l)" />
          <path className="p-bladeR" d="M768 222L933 552L768 395Z" fill="url(#intro-r)" />
          <path className="p-star" d="M768 447Q771.5 488.5 802 492Q771.5 495.5 768 560Q764.5 495.5 734 492Q764.5 488.5 768 447Z" style={{ fill: 'var(--mark-star)' }} />
        </svg>
        <Wordmark className="intro-wordmark" />
        <span className="intro-tagline">OPEN SOURCE DOWNLOADER</span>
      </div>
    </div>
  )
}
