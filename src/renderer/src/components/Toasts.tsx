import type { ToastItem } from '../lib/useWaypoint'
import { Icon } from './Icons'
import { IconButton } from './ui'

const ICONS = { success: 'checkCircle', error: 'alert', info: 'info' } as const

export function Toasts({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind} ${t.leaving ? 'leaving' : ''}`}>
          <Icon name={ICONS[t.kind]} size={18} />
          <span>
            {t.text}
            {t.link && (
              <>
                {' '}
                <a className="toast-link" href={t.link.url} onClick={(e) => (e.preventDefault(), window.open(t.link!.url))}>
                  {t.link.label}
                </a>
              </>
            )}
          </span>
          <IconButton icon="x" label="Dismiss" onClick={() => onDismiss(t.id)} />
        </div>
      ))}
    </div>
  )
}
