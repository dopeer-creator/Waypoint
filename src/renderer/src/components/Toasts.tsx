import type { ToastItem } from '../lib/useWaypoint'
import { Icon } from './Icons'
import { IconButton } from './ui'

const ICONS = { success: 'checkCircle', error: 'alert', info: 'info' } as const

export function Toasts({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <Icon name={ICONS[t.kind]} size={18} />
          <span>{t.text}</span>
          <IconButton icon="x" label="Dismiss" onClick={() => onDismiss(t.id)} />
        </div>
      ))}
    </div>
  )
}
