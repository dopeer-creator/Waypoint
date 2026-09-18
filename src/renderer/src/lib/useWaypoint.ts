import { useCallback, useEffect, useState } from 'react'
import type { AppSnapshot, ClipboardOffer, Settings, Toast, UpdateState } from '@shared/types'

const api = window.waypoint

const EMPTY: AppSnapshot = {
  links: [],
  batches: [],
  resolver: { running: false, phase: 'idle', current: 0, total: 0, currentLinkId: null, message: null },
  stats: { speed: 0, active: 0, queued: 0, total: 0 },
  extensionConnected: false,
  themeMedia: {}
}

export interface ToastItem extends Toast {
  id: number
  /** Set just before removal so the toast can fade out rather than vanish. */
  leaving?: boolean
}

const TOAST_FADE_MS = 300

let toastId = 0

export function useWaypoint() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY)
  const [settings, setSettingsState] = useState<Settings | null>(null)
  const [update, setUpdate] = useState<UpdateState>({ state: 'idle' })
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [clipboardOffer, setClipboardOffer] = useState<ClipboardOffer | null>(null)

  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  const pushToast = useCallback(
    (toast: Toast) => {
      const id = ++toastId
      setToasts((list) => [...list.slice(-3), { ...toast, id }])
      const duration = toast.duration ?? (toast.kind === 'error' ? 8000 : 4500)
      setTimeout(() => setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))), duration - TOAST_FADE_MS)
      setTimeout(() => dismissToast(id), duration)
    },
    [dismissToast]
  )

  useEffect(() => {
    void api.getSnapshot().then(setSnapshot)
    void api.getSettings().then(setSettingsState)
    const offs = [
      api.onSnapshot(setSnapshot),
      api.onSettings(setSettingsState),
      api.onUpdate(setUpdate),
      api.onToast(pushToast),
      api.onClipboardOffer(setClipboardOffer)
    ]
    return () => offs.forEach((off) => off())
  }, [pushToast])

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettingsState((s) => (s ? { ...s, ...patch } : s))
    await api.setSettings(patch)
  }, [])

  const clearClipboardOffer = useCallback(() => setClipboardOffer(null), [])

  return { snapshot, settings, saveSettings, update, toasts, pushToast, dismissToast, clipboardOffer, clearClipboardOffer, api }
}

/** Runs an API call and turns a thrown error into a toast. */
export function guard(pushToast: (t: Toast) => void) {
  return async <T>(work: Promise<T>): Promise<T | undefined> => {
    try {
      return await work
    } catch (err) {
      const message = (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      pushToast({ kind: 'error', text: message })
      return undefined
    }
  }
}
