import { useEffect, useMemo, useState } from 'react'
import type { WaypointApi } from '@shared/api'
import { groupFiles } from '@shared/grouping'
import type { Batch, DiskSpace, LinkItem, Settings } from '@shared/types'
import { formatBytes, plural } from '../lib/format'
import { Icon } from './Icons'
import { Button, Modal, Toggle } from './ui'

const INVALID = /[<>:"/\\|?*\x00-\x1f]/g
const clean = (s: string): string => s.replace(INVALID, '_').trim()

function timestampName(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Batch ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`
}

interface Props {
  links: LinkItem[]
  settings: Settings
  api: WaypointApi
  run: <T>(work: Promise<T>) => Promise<T | undefined>
  onClose: () => void
  onCreated: (batches: Batch[]) => void
}

export function BatchDialog({ links, settings, api, run, onClose, onCreated }: Props) {
  // Cluster the resolved files into per-application groups (parts + extras of one game land together).
  const groups = useMemo(() => groupFiles(links.map((l) => ({ id: l.id, name: l.filename ?? l.url }))), [links])
  const [baseFolder, setBaseFolder] = useState(settings.baseFolder)
  const [extract, setExtract] = useState(settings.extractDefault)
  const [deleteArchives, setDeleteArchives] = useState(settings.deleteArchivesAfterExtract)
  const [disk, setDisk] = useState<DiskSpace | null>(null)
  const [separate, setSeparate] = useState(groups.length > 1)
  const [names, setNames] = useState<string[]>(() => groups.map((g) => g.title || timestampName()))
  const [singleName, setSingleName] = useState(() => (groups.length === 1 ? groups[0].title : '') || timestampName())
  const [busy, setBusy] = useState(false)

  const multi = groups.length > 1
  const base = baseFolder.replace(/[\\/]+$/, '')

  // Disk guard: known size is what the resolver learned; hosts often report it only once downloading starts.
  const knownSize = links.reduce((sum, l) => sum + l.totalBytes, 0)
  const lowSpace = disk !== null && knownSize > 0 && knownSize > disk.free

  useEffect(() => {
    let live = true
    const id = setTimeout(() => void api.diskSpace(baseFolder).then((d) => live && setDisk(d)), 250)
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [baseFolder, api])

  // The batches that will actually be created, in {name, linkIds} form.
  const plan = separate
    ? groups.map((g, i) => ({ name: clean(names[i]) || `Batch ${i + 1}`, ids: g.ids }))
    : [{ name: clean(singleName) || 'Batch', ids: links.map((l) => l.id) }]

  const valid = baseFolder.trim().length > 0 && plan.every((p) => p.name.length > 0)

  const browse = async () => {
    const folder = await run(api.pickFolder(baseFolder))
    if (folder) setBaseFolder(folder)
  }

  const setName = (i: number, value: string) => setNames((prev) => prev.map((n, j) => (j === i ? value : n)))

  const start = async () => {
    setBusy(true)
    const created: Batch[] = []
    for (const p of plan) {
      const batch = await run(api.createBatch({ name: p.name, baseFolder, extract, deleteArchives: extract && deleteArchives, linkIds: p.ids }))
      if (batch) created.push(batch)
    }
    setBusy(false)
    if (created.length) onCreated(created)
  }

  return (
    <Modal
      title="Start downloads"
      onClose={onClose}
      footer={
        <>
          <span className="hint">
            {plural(links.length, 'file')}
            {separate ? ` · ${plural(plan.length, 'batch')}` : ''} · {settings.maxConcurrent} at a time
          </span>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="download" onClick={start} disabled={busy || !valid}>
            {separate && plan.length > 1 ? `Start ${plan.length} batches` : 'Start downloading'}
          </Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="batch-folder">Save to</label>
        <div className="field-row">
          <input id="batch-folder" className="input" value={baseFolder} onChange={(e) => setBaseFolder(e.target.value)} />
          <Button icon="folder" onClick={browse}>
            Browse
          </Button>
        </div>
        {disk && (
          <div className={`disk-line ${lowSpace ? 'low' : ''}`}>
            <Icon name={lowSpace ? 'alert' : 'database'} size={14} />
            {formatBytes(disk.free)} free{knownSize > 0 ? ` · batch needs about ${formatBytes(knownSize)}` : ''}
            {lowSpace ? ' — not enough space' : ''}
          </div>
        )}
      </div>

      {multi && (
        <div className="switch-row">
          <Icon name="layers" size={20} />
          <div className="setting-text">
            <div className="setting-label">Separate batch per app</div>
            <div className="setting-desc">Waypoint found {groups.length} apps in these files. Keep them in their own folders, or download as one batch.</div>
          </div>
          <Toggle checked={separate} onChange={setSeparate} label="Separate batch per app" />
        </div>
      )}

      {separate ? (
        <div className="field">
          <label>{multi ? 'Batches' : 'Batch name'}</label>
          <div className="group-list">
            {groups.map((g, i) => (
              <div className="group-row" key={i}>
                <input className="input" value={names[i]} onChange={(e) => setName(i, e.target.value)} aria-label={`Batch ${i + 1} name`} />
                <span className="group-count">{plural(g.ids.length, 'file')}</span>
              </div>
            ))}
          </div>
          <div className="path-preview">
            <Icon name="folder" size={15} />
            {base}\{clean(names[0]) || 'Batch'}
            {separate && groups.length > 1 ? ` · +${groups.length - 1} more` : ''}
          </div>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="batch-name">Batch name</label>
          <input
            id="batch-name"
            className="input"
            value={singleName}
            autoFocus
            onChange={(e) => setSingleName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && valid && void start()}
          />
          <div className="path-preview">
            <Icon name="folder" size={15} />
            {base}\{clean(singleName) || 'Batch'}
          </div>
        </div>
      )}

      <div className="switch-row">
        <Icon name="archive" size={20} />
        <div className="setting-text">
          <div className="setting-label">Extract archives after download?</div>
          <div className="setting-desc">Runs WinRAR on each archive set (including multi-part RARs) once every file is done. Archives are kept.</div>
        </div>
        <Toggle checked={extract} onChange={setExtract} label="Extract archives after download" />
      </div>

      {extract && (
        <div className="switch-row">
          <Icon name="trash" size={20} />
          <div className="setting-text">
            <div className="setting-label">Delete archives after extract</div>
            <div className="setting-desc">Removes the original .rar/.zip files once a set extracts cleanly. Off keeps them.</div>
          </div>
          <Toggle checked={deleteArchives} onChange={setDeleteArchives} label="Delete archives after extract" />
        </div>
      )}
    </Modal>
  )
}
