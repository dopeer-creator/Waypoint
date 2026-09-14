import { useMemo, useState } from 'react'
import type { WaypointApi } from '@shared/api'
import type { Batch, LinkItem, Settings } from '@shared/types'
import { plural } from '../lib/format'
import { Icon } from './Icons'
import { Button, Modal, Toggle } from './ui'

const ARCHIVE_SUFFIX = /(\.part\d+\.rar|\.(rar|zip|7z)(\.\d{3})?|\.r\d{2,3}|\.z\d{2})$/i

/** Guesses a batch name from the files: shared archive name, else common prefix, else a timestamp. */
function suggestName(links: LinkItem[]): string {
  const stems = links.map((l) => (l.filename ?? '').replace(ARCHIVE_SUFFIX, '').replace(/\.[a-z0-9]{2,4}$/i, ''))
  if (stems.length && stems[0] && stems.every((s) => s === stems[0])) return stems[0]
  let prefix = stems[0] ?? ''
  for (const s of stems) while (prefix && !s.startsWith(prefix)) prefix = prefix.slice(0, -1)
  prefix = prefix.replace(/[\s._-]+$/, '')
  if (prefix.length >= 3) return prefix
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Batch ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`
}

const INVALID = /[<>:"/\\|?*\x00-\x1f]/g

interface Props {
  links: LinkItem[]
  settings: Settings
  api: WaypointApi
  run: <T>(work: Promise<T>) => Promise<T | undefined>
  onClose: () => void
  onCreated: (batch: Batch) => void
}

export function BatchDialog({ links, settings, api, run, onClose, onCreated }: Props) {
  const initialName = useMemo(() => suggestName(links), [links])
  const [baseFolder, setBaseFolder] = useState(settings.baseFolder)
  const [name, setName] = useState(initialName)
  const [extract, setExtract] = useState(settings.extractDefault)
  const [busy, setBusy] = useState(false)

  const cleanName = name.replace(INVALID, '_').trim()
  const target = `${baseFolder.replace(/[\\/]+$/, '')}\\${cleanName || 'Batch'}`

  const browse = async () => {
    const folder = await run(api.pickFolder(baseFolder))
    if (folder) setBaseFolder(folder)
  }

  const start = async () => {
    setBusy(true)
    const batch = await run(api.createBatch({ name: cleanName, baseFolder, extract, linkIds: links.map((l) => l.id) }))
    setBusy(false)
    if (batch) onCreated(batch)
  }

  return (
    <Modal
      title="Start downloads"
      onClose={onClose}
      footer={
        <>
          <span className="hint">{plural(links.length, 'file')} · {settings.maxConcurrent} at a time</span>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="download" onClick={start} disabled={busy || !cleanName || !baseFolder}>
            Start downloading
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
      </div>

      <div className="field">
        <label htmlFor="batch-name">Batch name</label>
        <input
          id="batch-name"
          className="input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && cleanName && void start()}
        />
        <div className="path-preview">
          <Icon name="folder" size={15} />
          {target}
        </div>
      </div>

      <div className="switch-row">
        <Icon name="archive" size={20} />
        <div className="setting-text">
          <div className="setting-label">Extract archives after download?</div>
          <div className="setting-desc">Runs WinRAR on each archive set (including multi-part RARs) once every file is done. Archives are kept.</div>
        </div>
        <Toggle checked={extract} onChange={setExtract} label="Extract archives after download" />
      </div>
    </Modal>
  )
}
