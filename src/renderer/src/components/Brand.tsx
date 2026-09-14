import { useId } from 'react'

/** The Waypoint arrow mark. Colours come from the --mark-* theme variables. */
export function Mark({ size = 32 }: { size?: number }) {
  const id = useId().replace(/:/g, '')
  const stop = (offset: string, variable: string) => <stop offset={offset} style={{ stopColor: `var(${variable})` }} />
  return (
    <svg width={size} height={size} viewBox="588 211 360 360" aria-label="Waypoint">
      <defs>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="0" y2="1">
          {stop('0', '--mark-l1')}
          {stop('1', '--mark-l2')}
        </linearGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="0" y2="1">
          {stop('0', '--mark-r1')}
          {stop('1', '--mark-r2')}
        </linearGradient>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          {stop('0', '--mark-arc1')}
          {stop('1', '--mark-arc2')}
        </linearGradient>
      </defs>
      <path d="M722 269.5A167 167 0 0 0 606.7 473.2" fill="none" stroke={`url(#${id}a)`} strokeWidth="9" />
      <path d="M814 269.5A167 167 0 0 1 929.3 473.2" fill="none" stroke={`url(#${id}a)`} strokeWidth="9" />
      <path d="M768 222L603 552L768 395Z" fill={`url(#${id}l)`} />
      <path d="M768 222L933 552L768 395Z" fill={`url(#${id}r)`} />
      <path
        d="M768 447Q771.5 488.5 802 492Q771.5 495.5 768 560Q764.5 495.5 734 492Q764.5 488.5 768 447Z"
        style={{ fill: 'var(--mark-star)' }}
      />
    </svg>
  )
}

/** "WΛYPOINT" drawn as strokes so it needs no font. */
export function Wordmark({ className = 'wordmark' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="-8 -8 936 116"
      fill="none"
      stroke="currentColor"
      strokeWidth="13"
      strokeMiterlimit="1.5"
      role="img"
      aria-label="Waypoint"
    >
      <path d="M0 0L26 100L56 26L86 100L112 0" />
      <path d="M148 100L194 0L240 100" />
      <path d="M276 0L322 52L368 0M322 52V100" />
      <path d="M410.5 100V6.5H457A25 25 0 0 1 457 56.5H410.5" />
      <rect x="531.5" y="6.5" width="87" height="87" rx="24" />
      <path d="M667.5 0V100" />
      <path d="M716.5 100V0L791.5 100V0" />
      <path d="M834 6.5H920M877 6.5V100" />
    </svg>
  )
}
