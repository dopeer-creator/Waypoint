import { useMemo, useState } from 'react'
import type { WaypointApi } from '@shared/api'
import type { AppSnapshot, Batch, LinkItem } from '@shared/types'
import { Icon } from '../components/Icons'
import { RemoveBatchDialog } from '../components/RemoveBatchDialog'
import { SpeedGraph } from '../components/SpeedGraph'
import { Button, Chip, IconButton, Progress, type Tone } from '../components/ui'
import { formatBytes, formatDuration, formatEta, formatSpeed, percent } from '../lib/format'
import { batchStatus, downloadStatus } from '../lib/status'

type Filter = 'all' | 'active' | 'queued' | 'completed' | 'failed'

const FILTERS: Record<Filter, (l: LinkItem) => boolean> = {
  all: () => true,
  active: (l) => l.dlStatus === 'active',
  queued: (l) => l.dlStatus === 'queued' || l.dlStatus === 'paused' || l.dlStatus === 'expired',
  completed: (l) => l.dlStatus === 'complete',
  failed: (l) => l.dlStatus === 'error'
}

interface Props {
  snapshot: AppSnapshot
  api: WaypointApi
  run: <T>(work: Promise<T>) => Promise<T | undefined>
  onGoToGrabber: () => void
  /** Settings.deleteFilesOnRemove — where the remove dialog's toggle starts. */
  deleteFilesDefault: boolean
  onRememberDeleteFiles: (deleteFiles: boolean) => void
  onToast: (text: string) => void
}

export function Downloads({ snapshot, api, run, onGoToGrabber, deleteFilesDefault, onRememberDeleteFiles, onToast }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [removing, setRemoving] = useState<Batch | null>(null)
  // Batches start expanded while running and collapsed once done; clicking flips that default.
  const [flipped, setFlipped] = useState<Set<number>>(new Set())

  const byBatch = useMemo(() => {
    const map = new Map<number, LinkItem[]>()
    for (const link of snapshot.links) {
      if (link.batchId === null) continue
      const list = map.get(link.batchId) ?? []
      list.push(link)
      map.set(link.batchId, list)
    }
    return map
  }, [snapshot.links])

  const allLinks = [...byBatch.values()].flat()
  const count = (f: Filter) => allLinks.filter(FILTERS[f]).length
  const visibleBatches = snapshot.batches.filter((b) => filter === 'all' || (byBatch.get(b.id) ?? []).some(FILTERS[filter]))

  const hasRunning = snapshot.batches.some((b) => b.status === 'downloading')
  const hasPaused = snapshot.batches.some((b) => b.status === 'paused')

  if (!snapshot.batches.length) {
    return (
      <div className="empty">
        <div className="empty-icon">
          <Icon name="download" size={26} />
        </div>
        <h3>Nothing downloading</h3>
        <p>Resolve links in the Link Grabber, then start a batch. Its files show up here.</p>
        <Button variant="primary" icon="grabber" onClick={onGoToGrabber}>
          Open Link Grabber
        </Button>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="toolbar">
        <div className="tabs">
          {(
            [
              ['all', 'All'],
              ['active', 'Downloading'],
              ['queued', 'Queued'],
              ['completed', 'Completed'],
              ['failed', 'Failed']
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`tab ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>
              {label}
              <span className="count">{count(id)}</span>
            </button>
          ))}
        </div>
        <span className="spacer" />
        <SpeedGraph speed={snapshot.stats.speed} />
        <Button size="sm" icon="pause" onClick={() => run(api.pauseAll())} disabled={!hasRunning}>
          Pause all
        </Button>
        <Button size="sm" icon="play" onClick={() => run(api.resumeAll())} disabled={!hasPaused}>
          Resume all
        </Button>
      </div>

      <div className="row head dl-grid dl-head" aria-hidden>
        <span />
        <span>File</span>
        <span>Progress</span>
        <span>Downloaded</span>
        <span>%</span>
        <span>Speed</span>
        <span>ETA</span>
        <span>Status</span>
        <span />
      </div>

      <div>
        {visibleBatches.map((batch) => {
          const openByDefault = batch.status !== 'done'
          const open = flipped.has(batch.id) ? !openByDefault : openByDefault
          return (
            <BatchCard
              key={batch.id}
              batch={batch}
              links={byBatch.get(batch.id) ?? []}
              filter={FILTERS[filter]}
              open={open}
              onToggle={() =>
                setFlipped((prev) => {
                  const next = new Set(prev)
                  if (next.has(batch.id)) next.delete(batch.id)
                  else next.add(batch.id)
                  return next
                })
              }
              onRemove={() => setRemoving(batch)}
              api={api}
              run={run}
            />
          )
        })}
        {visibleBatches.length === 0 && <div className="card empty">Nothing in this view.</div>}
      </div>

      {removing && (
        <RemoveBatchDialog
          batch={removing}
          api={api}
          run={run}
          deleteFilesDefault={deleteFilesDefault}
          onRemember={onRememberDeleteFiles}
          onToast={onToast}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}

interface BatchCardProps {
  batch: Batch
  links: LinkItem[]
  filter: (l: LinkItem) => boolean
  open: boolean
  onToggle: () => void
  onRemove: () => void
  api: WaypointApi
  run: <T>(work: Promise<T>) => Promise<T | undefined>
}

function BatchCard({ batch, links, filter, open, onToggle, onRemove, api, run }: BatchCardProps) {
  const total = links.reduce((s, l) => s + l.totalBytes, 0)
  const done = links.reduce((s, l) => s + (l.dlStatus === 'complete' ? l.totalBytes : l.doneBytes), 0)
  const speed = links.reduce((s, l) => s + l.speed, 0)
  const completed = links.filter((l) => l.dlStatus === 'complete').length
  const allSized = links.every((l) => l.totalBytes > 0)
  const pct = percent(done, total)
  // Files download side by side, so the batch finishes when its slowest file does. Use whichever is later:
  // everything left at the combined speed, or the slowest active file's own ETA.
  const slowestFileSec = links
    .filter((l) => l.dlStatus === 'active' && l.speed > 0)
    .reduce((max, l) => Math.max(max, (l.totalBytes - l.doneBytes) / l.speed), 0)
  const batchEtaSec = Math.max(slowestFileSec, speed > 0 ? (total - done) / speed : 0)
  const [label, tone] = batchStatus(batch)
  const barTone: Tone = batch.status === 'done' ? 'success' : batch.status === 'error' ? 'error' : batch.status === 'paused' ? 'warning' : batch.status === 'extracting' ? 'accent' : 'primary'
  const allComplete = links.length > 0 && completed === links.length

  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div className="card batch">
      <div className={`row dl-grid batch-head ${open ? 'open' : ''}`} onClick={onToggle}>
        <Icon name="chevronRight" size={16} className="chevron" />
        <div className="cell-main">
          <span className="primary-text batch-name" title={batch.name}>
            {batch.name}
          </span>
          <span className="subtle" title={batch.dir}>
            {completed}/{links.length} files · {batch.dir}
          </span>
        </div>
        <Progress value={pct} tone={barTone} indeterminate={batch.status === 'extracting'} />
        <span className="num">
          {formatBytes(done)} / {total ? `${formatBytes(total)}${allSized ? '' : '+'}` : '—'}
        </span>
        <span className="num strong">{Math.floor(pct)}%</span>
        <span className="num">{formatSpeed(speed)}</span>
        <span className="num">{batch.status === 'downloading' ? formatDuration(batchEtaSec) : '—'}</span>
        <Chip tone={tone} pulse={batch.status === 'extracting'} title={batch.extractError ?? undefined}>
          {label}
        </Chip>
        <div className="actions" onClick={stop}>
          {batch.status === 'downloading' && <IconButton icon="pause" label="Pause batch" onClick={() => run(api.pauseBatch(batch.id))} />}
          {batch.status === 'paused' && <IconButton icon="play" label="Resume batch" onClick={() => run(api.resumeBatch(batch.id))} />}
          {batch.status === 'error' && !allComplete && <IconButton icon="retry" label="Retry failed files" onClick={() => run(api.resumeBatch(batch.id))} />}
          {allComplete && batch.status !== 'extracting' && (
            <IconButton icon="archive" label={batch.extractStatus === 'off' ? 'Extract archives' : 'Extract again'} onClick={() => run(api.extractBatch(batch.id))} />
          )}
          <IconButton icon="folder" label="Open folder" onClick={() => run(api.openPath(batch.dir))} />
          <IconButton icon="trash" label="Remove" onClick={onRemove} disabled={batch.status === 'extracting'} />
        </div>
      </div>

      {open && (
        <div className="batch-body">
          {batch.extractError && (
            <div className="notice">
              <Icon name="alert" size={16} />
              <span>{batch.extractError}</span>
            </div>
          )}
          {links.filter(filter).map((link) => (
            <FileRow key={link.id} link={link} api={api} run={run} />
          ))}
        </div>
      )}
    </div>
  )
}

function FileRow({ link, api, run }: { link: LinkItem; api: WaypointApi; run: <T>(work: Promise<T>) => Promise<T | undefined> }) {
  // Fall back rather than destructure undefined: an unrecognised status would otherwise throw during render and
  // take the whole app down to a blank window, which is a wildly disproportionate result for one odd row.
  const [label, tone] = downloadStatus[link.dlStatus] ?? downloadStatus.none
  const complete = link.dlStatus === 'complete'
  const active = link.dlStatus === 'active'
  const done = complete ? link.totalBytes : link.doneBytes
  const pct = complete ? 100 : percent(done, link.totalBytes)
  const name = link.filename ?? link.path?.split(/[\\/]/).pop() ?? link.url
  const barTone: Tone = complete ? 'success' : link.dlStatus === 'error' ? 'error' : link.dlStatus === 'paused' ? 'warning' : link.dlStatus === 'queued' ? 'neutral' : 'primary'

  return (
    <div className="row dl-grid file-row">
      <span />
      <div className="cell-main">
        <span className="primary-text file-name" title={name}>
          {name}
        </span>
        {link.error && !complete && (
          <span className={link.dlStatus === 'expired' ? 'subtle' : 'error-text'} title={link.error}>
            {link.error}
          </span>
        )}
      </div>
      <Progress value={pct} tone={barTone} indeterminate={link.dlStatus === 'expired'} />
      <span className="num">
        {formatBytes(done)} / {link.totalBytes ? formatBytes(link.totalBytes) : '—'}
      </span>
      <span className="num">{Math.floor(pct)}%</span>
      <span className="num">{active ? formatSpeed(link.speed) : '—'}</span>
      <span className="num">{active ? formatEta(link.totalBytes - done, link.speed) : '—'}</span>
      <Chip tone={tone} pulse={active || link.dlStatus === 'expired'}>
        {label}
      </Chip>
      <div className="actions">
        {(link.dlStatus === 'queued' || link.dlStatus === 'paused') && (
          <>
            <IconButton icon="chevronUp" label="Move up in queue" onClick={() => run(api.moveLink(link.id, -1))} />
            <IconButton icon="chevronDown" label="Move down in queue" onClick={() => run(api.moveLink(link.id, 1))} />
          </>
        )}
        {(active || link.dlStatus === 'queued') && <IconButton icon="pause" label="Pause" onClick={() => run(api.pauseLinks([link.id]))} />}
        {link.dlStatus === 'paused' && <IconButton icon="play" label="Resume" onClick={() => run(api.resumeLinks([link.id]))} />}
        {link.dlStatus === 'error' && <IconButton icon="retry" label="Retry" onClick={() => run(api.retryLinks([link.id]))} />}
        {complete && link.path && <IconButton icon="external" label="Show in folder" onClick={() => run(api.showInFolder(link.path!))} />}
      </div>
    </div>
  )
}
