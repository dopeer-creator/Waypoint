import { useEffect, useState } from 'react'
import type { WaypointApi } from '@shared/api'
import type { Batch, RemovalPlan } from '@shared/types'
import { formatBytes, plural } from '../lib/format'
import { Button, Modal, Toggle } from './ui'

interface Props {
  batch: Batch
  api: WaypointApi
  run: <T>(work: Promise<T>) => Promise<T | undefined>
  /** The remembered answer, which is where the toggle starts. */
  deleteFilesDefault: boolean
  onRemember: (deleteFiles: boolean) => void
  onToast: (text: string) => void
  onClose: () => void
}

/**
 * Confirms removing a batch, and whether its downloads go too. The size is measured on disk first, so the
 * question is "delete 19 files (38.2 GB)" rather than a guess.
 */
export function RemoveBatchDialog({ batch, api, run, deleteFilesDefault, onRemember, onToast, onClose }: Props) {
  const [plan, setPlan] = useState<RemovalPlan | null>(null)
  const [deleteFiles, setDeleteFiles] = useState(deleteFilesDefault)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void run(api.removalPlan(batch.id)).then((p) => setPlan(p ?? { dir: batch.dir, files: 0, bytes: 0 }))
  }, [api, run, batch.id, batch.dir])

  const hasFiles = (plan?.files ?? 0) > 0
  const willDelete = hasFiles && deleteFiles

  const remove = async () => {
    setBusy(true)
    if (hasFiles && deleteFiles !== deleteFilesDefault) onRemember(deleteFiles)
    const result = await run(api.removeBatch(batch.id, willDelete))
    onClose()
    if (!result) return
    if (!willDelete) onToast(`Removed "${batch.name}"`)
    else if (result.failed) onToast(`Removed "${batch.name}" — ${plural(result.failed, 'file')} couldn't be deleted (still open?)`)
    else onToast(`Removed "${batch.name}" and deleted ${plural(result.deleted, 'file')}`)
  }

  return (
    <Modal
      title={`Remove "${batch.name}"?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <span className="spacer" />
          <Button variant="danger" icon="trash" disabled={!plan || busy} onClick={remove}>
            {willDelete ? 'Remove and delete' : 'Remove from list'}
          </Button>
        </>
      }
    >
      {!plan ? (
        <p className="muted">Checking what's on disk…</p>
      ) : hasFiles ? (
        <>
          <div className="switch-row">
            <div className="setting-text">
              <div className="setting-label">
                Also delete {plural(plan.files, 'downloaded file')} ({formatBytes(plan.bytes)})
              </div>
              <div className="setting-desc">Deleted permanently, not sent to the Recycle Bin.</div>
            </div>
            <Toggle label="Also delete downloaded files" checked={deleteFiles} onChange={setDeleteFiles} />
          </div>
          <p className="muted">
            Only the files Waypoint downloaded are deleted. Anything extracted from them, or anything else in{' '}
            <code>{plan.dir}</code>, stays where it is.
          </p>
        </>
      ) : (
        <p className="muted">
          None of this batch's downloads are left on disk, so only the list entry goes. Nothing in <code>{plan.dir}</code> is
          touched.
        </p>
      )}
    </Modal>
  )
}
