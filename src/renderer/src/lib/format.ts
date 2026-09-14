const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  return `${value >= 100 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${UNITS[i]}`
}

export const formatSpeed = (bps: number): string => (bps > 0 ? `${formatBytes(bps)}/s` : '—')

export function formatEta(remainingBytes: number, bps: number): string {
  if (bps <= 0 || remainingBytes <= 0) return '—'
  const s = Math.round(remainingBytes / bps)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

export const percent = (done: number, total: number): number => (total > 0 ? Math.min(100, (done / total) * 100) : 0)

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
