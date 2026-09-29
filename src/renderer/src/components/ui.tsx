import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { Icon, type IconName } from './Icons'

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'accent' | 'secondary'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm'
  icon?: IconName
}

export function Button({ variant = 'secondary', size, icon, children, className = '', ...rest }: ButtonProps) {
  return (
    <button className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 16} />}
      {children}
    </button>
  )
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; boxed?: boolean }

export function IconButton({ icon, label, boxed, className = '', ...rest }: IconButtonProps) {
  return (
    <button className={`icon-btn ${boxed ? 'boxed' : ''} ${className}`} title={label} aria-label={label} {...rest}>
      <Icon name={icon} size={16} />
    </button>
  )
}

export function Chip({ tone = 'neutral', pulse, title, children }: { tone?: Tone; pulse?: boolean; title?: string; children: ReactNode }) {
  return (
    <span className={`chip ${tone} ${pulse ? 'pulse' : ''}`} title={title}>
      {children}
    </span>
  )
}

export function Progress({ value = 0, tone = 'primary', indeterminate }: { value?: number; tone?: Tone; indeterminate?: boolean }) {
  return (
    <div className={`progress ${tone} ${indeterminate ? 'indeterminate' : ''}`} role="progressbar" aria-valuenow={Math.round(value)}>
      <span style={indeterminate ? undefined : { width: `${value}%` }} />
    </div>
  )
}

/** A truncated line that slides to reveal the rest of the text on hover, instead of relying on a title tooltip. */
export function ScrollText({ text, className = '', title }: { text: string; className?: string; title?: string }) {
  const outerRef = useRef<HTMLSpanElement>(null)
  const innerRef = useRef<HTMLSpanElement>(null)
  const [dist, setDist] = useState(0)

  function handleEnter(): void {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return
    setDist(Math.max(0, inner.scrollWidth - outer.clientWidth))
  }

  return (
    <span
      ref={outerRef}
      className={className}
      title={title}
      style={dist > 0 ? { display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'clip' } : { display: 'block', overflow: 'hidden', whiteSpace: 'nowrap' }}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setDist(0)}
    >
      <span
        ref={innerRef}
        className={dist > 0 ? 'scroll-text-inner marquee' : 'scroll-text-inner'}
        style={dist > 0 ? ({ '--marquee-dist': `-${dist}px`, '--marquee-duration': `${Math.max(2.4, dist / 30)}s` } as CSSProperties) : undefined}
      >
        {text}
      </span>
    </span>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} />
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{footer}</div>
      </div>
    </div>
  )
}

/** Number field that only commits on blur or Enter, so half-typed values aren't clamped mid-edit. */
export function NumberInput({ value, min, max, onCommit, label }: { value: number; min: number; max: number; onCommit: (n: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const commit = () => {
    const n = Number(draft)
    if (!Number.isFinite(n) || draft.trim() === '') return setDraft(String(value))
    const clamped = Math.min(max, Math.max(min, Math.round(n)))
    setDraft(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }

  return (
    <input
      className="input num-input"
      inputMode="numeric"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  )
}
