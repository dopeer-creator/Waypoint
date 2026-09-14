import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
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
