import type { Batch, DownloadStatus, LinkStatus } from '@shared/types'
import type { Tone } from '../components/ui'

export const linkStatus: Record<LinkStatus, [label: string, tone: Tone]> = {
  pending: ['Pending', 'neutral'],
  resolving: ['Resolving', 'primary'],
  resolved: ['Resolved', 'success'],
  failed: ['Failed', 'error'],
  skipped: ['Skipped', 'warning']
}

export const downloadStatus: Record<DownloadStatus, [label: string, tone: Tone]> = {
  none: ['—', 'neutral'],
  queued: ['Queued', 'neutral'],
  active: ['Downloading', 'primary'],
  paused: ['Paused', 'warning'],
  complete: ['Completed', 'success'],
  error: ['Failed', 'error'],
  expired: ['Refreshing link', 'secondary']
}

export function batchStatus(batch: Batch): [label: string, tone: Tone] {
  switch (batch.status) {
    case 'extracting':
      return ['Extracting', 'accent']
    case 'done':
      return batch.extract && batch.extractStatus === 'done' ? ['Extracted', 'success'] : ['Done', 'success']
    case 'error':
      return batch.extractStatus === 'error' ? ['Extraction failed', 'error'] : ['Finished with errors', 'error']
    case 'paused':
      return ['Paused', 'warning']
    default:
      return ['Downloading', 'primary']
  }
}
