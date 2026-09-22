import { useMemo, useState } from 'react'
import type { WaypointApi } from '@shared/api'
import type { AddLinksResult, AppSnapshot, LinkItem, ResolveMode, Settings, Toast } from '@shared/types'
import { Icon } from '../components/Icons'
import { Button, Chip, IconButton, Progress } from '../components/ui'
import { hrefsFromHtml } from '@shared/links'
import { plural } from '../lib/format'
import { linkStatus } from '../lib/status'

type Filter = 'all' | 'pending' | 'resolved' | 'failed'

const isPending = (l: LinkItem) => l.status === 'pending' || l.status === 'resolving'
const isFailed = (l: LinkItem) => l.status === 'failed' || l.status === 'skipped'

interface Props {
  snapshot: AppSnapshot
  api: WaypointApi
  run: <T>(work: Promise<T>) => Promise<T | undefined>
  pushToast: (toast: Toast) => void
  onStartDownloads: (links: LinkItem[]) => void
  settings: Settings
  onOpenSettings: () => void
  /** Starts resolving — through App, so the first automatic run can show the how-it-works guide first. */
  onResolve: () => void
}

export function LinkGrabber({ snapshot, api, run, pushToast, onStartDownloads, settings, onOpenSettings, onResolve }: Props) {
  const [text, setText] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // A few hundred pasted links leaves nothing to browse by — this is a plain substring filter, not a re-fetch.
  const [query, setQuery] = useState('')

  const links = useMemo(() => snapshot.links.filter((l) => l.batchId === null), [snapshot.links])
  const pending = links.filter(isPending)
  const resolved = links.filter((l) => l.status === 'resolved')
  const failed = links.filter(isFailed)

  const byFilter = (l: LinkItem) =>
    filter === 'all' || (filter === 'pending' ? isPending(l) : filter === 'resolved' ? l.status === 'resolved' : isFailed(l))
  const needle = query.trim().toLowerCase()
  const byQuery = (l: LinkItem) => !needle || [l.filename, l.url, l.host].some((v) => v?.toLowerCase().includes(needle))
  const visible = links.filter((l) => byFilter(l) && byQuery(l))
  const selectedIds = visible.filter((l) => selected.has(l.id)).map((l) => l.id)
  const allSelected = visible.length > 0 && selectedIds.length === visible.length

  const addLinks = async () => {
    if (!text.trim()) return
    const result = await run(api.addLinks(text))
    if (!result) return
    if (!result.added && !result.duplicates) {
      pushToast({
        kind: 'error',
        text: 'No links found in that text. Select the links on the page and copy them, or right-click a link → Copy link address.'
      })
      return
    }
    const parts = [result.added ? `Added ${plural(result.added, 'link')}` : 'No new links']
    if (result.duplicates) parts.push(`${result.duplicates} already listed`)
    if (result.invalid) parts.push(`${plural(result.invalid, 'line')} ignored`)
    pushToast({ kind: result.added ? 'success' : 'info', text: parts.join(' · ') })
    if (result.added) setText('')
  }

  /** Inserts URLs at the cursor, replacing any selection, each on its own line. */
  const insertUrls = (el: HTMLTextAreaElement, urls: string[]) => {
    const before = text.slice(0, el.selectionStart)
    const after = text.slice(el.selectionEnd)
    const block = urls.join('\n')
    setText(`${before}${before && !before.endsWith('\n') ? '\n' : ''}${block}${after.startsWith('\n') ? '' : '\n'}${after}`)
    pushToast({ kind: 'info', text: `Found ${plural(urls.length, 'link')} behind the copied text` })
  }

  // Copied link text (e.g. file names on a download page) carries its real URLs only in the HTML clipboard data.
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const urls = hrefsFromHtml(e.clipboardData.getData('text/html'))
    if (!urls.length) return
    e.preventDefault()
    insertUrls(e.currentTarget, urls)
  }

  const onDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    // A dropped file — a .txt list, a saved page — reads through the same import as the button.
    const files = [...e.dataTransfer.files]
    if (files.length) {
      e.preventDefault()
      void importPaths(files.map((file) => api.pathForFile(file)))
      return
    }

    const uriList = e.dataTransfer
      .getData('text/uri-list')
      .split(/\r?\n/)
      .filter((line) => /^https?:\/\//i.test(line))
    const urls = [...new Set([...hrefsFromHtml(e.dataTransfer.getData('text/html')), ...uriList])]
    if (!urls.length) return
    e.preventDefault()
    insertUrls(e.currentTarget, urls)
  }

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const remove = async (ids: number[]) => {
    await run(api.removeLinks(ids))
    setSelected(new Set())
  }

  const reportImport = (result: AddLinksResult | null | undefined) => {
    if (result === undefined || result === null) return
    const parts = [result.added ? `Added ${plural(result.added, 'link')}` : 'No new links found in that file']
    if (result.duplicates) parts.push(`${result.duplicates} already listed`)
    pushToast({ kind: result.added ? 'success' : 'info', text: parts.join(' · ') })
  }

  const importFile = async () => reportImport(await run(api.importLinks()))
  const importPaths = async (paths: string[]) => reportImport(await run(api.importLinksFrom(paths)))

  return (
    <div className="page">
      <div className="card paste">
        <textarea
          className="textarea"
          rows={5}
          placeholder={'Paste links here — one per line, or any text that contains them.\nhttps://host.example/file/abc123\nhttps://host.example/file/def456'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) void addLinks()
          }}
        />
        <div className="paste-side">
          <p className="hint">
            Paste URLs, copy links straight off a page, or drop a .txt file of links here. <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to add.
          </p>
          <Button variant="primary" icon="plus" onClick={addLinks} disabled={!text.trim()}>
            Add links
          </Button>
          <Button icon="file" onClick={importFile}>
            Import from file
          </Button>
        </div>
      </div>

      <ResolverPanel
        snapshot={snapshot}
        mode={settings.resolveMode}
        extensionConnected={snapshot.extensionConnected}
        onSetup={onOpenSettings}
        pendingCount={pending.length}
        resolvedCount={resolved.length}
        failedCount={failed.length}
        onStart={onResolve}
        onStop={() => run(api.resolverStop())}
        onSkip={() => run(api.resolverSkip())}
        onDownload={() => onStartDownloads(resolved)}
      />

      {links.length > 0 && (
        <>
          <div className="toolbar">
            <div className="tabs">
              {(
                [
                  ['all', 'All', links.length],
                  ['pending', 'Pending', pending.length],
                  ['resolved', 'Resolved', resolved.length],
                  ['failed', 'Failed', failed.length]
                ] as const
              ).map(([id, label, count]) => (
                <button key={id} className={`tab ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>
                  {label}
                  <span className="count">{count}</span>
                </button>
              ))}
            </div>
            <span className="spacer" />
            {selectedIds.length > 0 && (
              <>
                <span className="hint">{selectedIds.length} selected</span>
                <Button size="sm" icon="retry" onClick={() => run(api.retryLinks(selectedIds))}>
                  Retry
                </Button>
                <Button size="sm" variant="danger" icon="trash" onClick={() => remove(selectedIds)}>
                  Remove
                </Button>
              </>
            )}
            {selectedIds.length === 0 && failed.length > 0 && (
              <Button size="sm" icon="retry" onClick={() => run(api.retryLinks(failed.map((l) => l.id)))}>
                Retry failed
              </Button>
            )}
          </div>

          {links.length > 8 && (
            <div className="search-row">
              <Icon name="search" size={15} />
              <input
                className="input search-input"
                placeholder="Find a link by name, URL or host…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Find a link"
              />
              {query && <IconButton icon="x" label="Clear search" onClick={() => setQuery('')} />}
            </div>
          )}

          <div className="card">
            <div className="row head grabber-row">
              <input
                type="checkbox"
                className="check"
                aria-label="Select all"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((l) => l.id)))}
              />
              <span>Link</span>
              <span>Host</span>
              <span>Status</span>
              <span />
            </div>
            {visible.map((link) => {
              const [label, tone] = linkStatus[link.status]
              return (
                <div key={link.id} className={`row grabber-row ${selected.has(link.id) ? 'selected' : ''}`}>
                  <input type="checkbox" className="check" aria-label="Select link" checked={selected.has(link.id)} onChange={() => toggle(link.id)} />
                  <div className="cell-main">
                    <span className="primary-text" title={link.filename ?? link.url}>
                      {link.filename ?? link.url}
                    </span>
                    {link.filename && <span className="subtle">{link.url}</span>}
                    {link.error && isFailed(link) && (
                      <span className="error-text" title={link.error}>
                        {link.error}
                      </span>
                    )}
                  </div>
                  <span className="muted ellipsis">{link.host}</span>
                  <Chip tone={tone} pulse={link.status === 'resolving'}>
                    {label}
                  </Chip>
                  <div className="actions">
                    {isFailed(link) && <IconButton icon="retry" label="Retry" onClick={() => run(api.retryLinks([link.id]))} />}
                    <IconButton icon="trash" label="Remove" disabled={link.status === 'resolving'} onClick={() => remove([link.id])} />
                  </div>
                </div>
              )
            })}
            {visible.length === 0 && <div className="empty">Nothing in this view.</div>}
          </div>
        </>
      )}

      {links.length === 0 && !snapshot.resolver.running && (
        <div className="empty">
          <div className="empty-icon">
            <Icon name="link" size={26} />
          </div>
          <h3>No links yet</h3>
          <p>Paste a batch of links above. Waypoint resolves them one by one in your browser, then downloads everything in parallel.</p>
        </div>
      )}
    </div>
  )
}

interface ResolverPanelProps {
  snapshot: AppSnapshot
  mode: ResolveMode
  extensionConnected: boolean
  onSetup: () => void
  pendingCount: number
  resolvedCount: number
  failedCount: number
  onStart: () => void
  onStop: () => void
  onSkip: () => void
  onDownload: () => void
}

function ResolverPanel({
  snapshot,
  mode,
  extensionConnected,
  onSetup,
  pendingCount,
  resolvedCount,
  failedCount,
  onStart,
  onStop,
  onSkip,
  onDownload
}: ResolverPanelProps) {
  const r = snapshot.resolver
  const current = snapshot.links.find((l) => l.id === r.currentLinkId)

  if (r.running) {
    const attention = r.phase === 'waiting-user'
    const refreshing = current?.batchId != null
    return (
      <div className={`card resolver ${attention ? 'attention' : ''}`}>
        <div className="resolver-icon">
          <Icon name={attention ? 'hand' : 'loader'} size={22} className={attention ? undefined : 'spin'} />
        </div>
        <div className="resolver-body">
          <div className="resolver-title">
            {refreshing ? 'Refreshing expired link' : `Resolving ${r.current}/${r.total}`}
            {attention && <Chip tone="warning">Needs you</Chip>}
          </div>
          <div className="resolver-sub">
            {r.message}
            {current ? ` · ${current.url}` : ''}
          </div>
          <Progress value={r.total ? ((r.current - 1) / r.total) * 100 : 0} tone={attention ? 'warning' : 'primary'} />
        </div>
        <div className="resolver-actions">
          <Button icon="skip" onClick={onSkip}>
            Skip
          </Button>
          <Button variant="danger" icon="stop" onClick={onStop}>
            Stop
          </Button>
        </div>
      </div>
    )
  }

  if (pendingCount > 0) {
    const handoff = mode === 'handoff'
    const needsSetup = handoff && !extensionConnected
    return (
      <div className={`card resolver ${needsSetup ? 'attention' : ''}`}>
        <div className="resolver-icon">
          <Icon name={needsSetup ? 'alert' : 'shield'} size={22} />
        </div>
        <div className="resolver-body">
          <div className="resolver-title">{plural(pendingCount, 'link')} waiting to resolve</div>
          <div className="resolver-sub">
            {needsSetup
              ? "Waypoint's browser extension isn't connected. Set it up once, and downloads you start in your browser come straight here."
              : handoff
                ? 'Each link opens as a normal tab in your browser, one at a time. Pass the check and click Download, and Waypoint takes the file.'
                : 'Waypoint opens the links in its own Chrome window and clicks through to the downloads, several at a time. Leave those tabs alone — you’re only needed if one asks for a Cloudflare check.'}
          </div>
        </div>
        <div className="resolver-actions">
          {needsSetup && (
            <Button icon="sliders" onClick={onSetup}>
              Set up extension
            </Button>
          )}
          {resolvedCount > 0 && (
            <Button icon="download" onClick={onDownload}>
              Download {resolvedCount} resolved
            </Button>
          )}
          <Button variant="primary" icon="play" onClick={onStart}>
            Resolve
          </Button>
        </div>
      </div>
    )
  }

  if (resolvedCount > 0) {
    const total = resolvedCount + failedCount
    return (
      <div className="card resolver ready">
        <div className="resolver-icon">
          <Icon name="checkCircle" size={22} />
        </div>
        <div className="resolver-body">
          <div className="resolver-title">
            Batch ready — {resolvedCount}/{total} resolved
          </div>
          <div className="resolver-sub">
            {failedCount ? `${plural(failedCount, 'link')} failed. Retry them or download what's ready.` : 'Choose a folder and start downloading.'}
          </div>
        </div>
        <div className="resolver-actions">
          <Button variant="primary" icon="download" onClick={onDownload}>
            Start downloads
          </Button>
        </div>
      </div>
    )
  }

  return null
}
