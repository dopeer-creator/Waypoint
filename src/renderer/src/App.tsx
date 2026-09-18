import { useEffect, useMemo, useState } from 'react'
import { THEMES } from '@shared/themes'
import type { LinkItem, ThemeId } from '@shared/types'
import { BatchDialog } from './components/BatchDialog'
import { Mark, Wordmark } from './components/Brand'
import { ClipboardPrompt } from './components/ClipboardPrompt'
import { Icon, type IconName } from './components/Icons'
import { IntroSplash } from './components/IntroSplash'
import { ThemeScene } from './components/ThemeScene'
import { Toasts } from './components/Toasts'
import { Button } from './components/ui'
import { formatSpeed } from './lib/format'
import { guard, useWaypoint } from './lib/useWaypoint'
import { Downloads } from './views/Downloads'
import { LinkGrabber } from './views/LinkGrabber'
import { SettingsView } from './views/Settings'
import { ThemesView } from './views/Themes'

type View = 'grabber' | 'downloads' | 'themes' | 'settings'

const TITLES: Record<View, string> = { grabber: 'Link Grabber', downloads: 'Downloads', themes: 'Themes', settings: 'Settings' }
const CORE_THEMES: ThemeId[] = THEMES.filter((t) => t.group === 'core').map((t) => t.id)
const THEME_LABEL = Object.fromEntries(THEMES.map((t) => [t.id, t.label])) as Record<ThemeId, string>

/** Short decorative line shown in the sidebar for each premium theme. */
const SCENE_TAGLINE: Partial<Record<ThemeId, string>> = {
  ragnarok: 'The end is a doorway.',
  jackdaw: 'No borders. Just files.',
  nightcity: 'Same destination. Less friction.',
  tsushima: '風を追え',
  wasteland: '> download. repeat._'
}

function useResolvedTheme(theme: ThemeId | undefined): Exclude<ThemeId, 'system'> {
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  if (!theme || theme === 'system') return dark ? 'midnight' : 'light'
  return theme
}

export default function App() {
  const { snapshot, settings, saveSettings, update, toasts, pushToast, dismissToast, clipboardOffer, clearClipboardOffer, api } = useWaypoint()
  const [view, setView] = useState<View>('grabber')
  const [intro, setIntro] = useState(true)
  const [batchLinks, setBatchLinks] = useState<LinkItem[] | null>(null)
  const theme = useResolvedTheme(settings?.theme)
  const run = useMemo(() => guard(pushToast), [pushToast])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    const css = getComputedStyle(document.documentElement)
    void api.setTitleBar({ color: css.getPropertyValue('--bg').trim(), symbolColor: css.getPropertyValue('--text-2').trim() })
  }, [theme, api])

  if (!settings) return null

  const grabberCount = snapshot.links.filter((l) => l.batchId === null).length
  const downloading = snapshot.stats.active + snapshot.stats.queued
  const nav: { id: View; label: string; icon: IconName; badge?: number }[] = [
    { id: 'grabber', label: 'Link Grabber', icon: 'grabber', badge: grabberCount },
    { id: 'downloads', label: 'Downloads', icon: 'download', badge: downloading },
    { id: 'themes', label: 'Themes', icon: 'contrast' },
    { id: 'settings', label: 'Settings', icon: 'sliders' }
  ]

  // The sidebar cycles only the lightweight core themes. Destination themes carry animated backgrounds, so they
  // are set from Settings; cycling out of one lands on a plain dark theme.
  const cycleTheme = () => {
    const i = CORE_THEMES.indexOf(settings.theme)
    const next = i === -1 ? 'midnight' : CORE_THEMES[(i + 1) % CORE_THEMES.length]
    void saveSettings({ theme: next })
  }

  const updateBusy = update.state === 'checking' || update.state === 'available' || update.state === 'downloading'
  const updateLabel = {
    idle: 'Check for updates',
    checking: 'Checking…',
    none: 'Up to date',
    available: 'Downloading update…',
    downloading: `Downloading ${update.state === 'downloading' ? update.percent : 0}%`,
    ready: 'Update ready',
    error: 'Check failed — retry'
  }[update.state]

  const installUpdate = () => {
    if (downloading > 0 && !confirm('Downloads are running. Restart now to install the update? They resume after the restart.')) return
    void run(api.installUpdate())
  }

  return (
    <div className="app">
      {intro && <IntroSplash onDone={() => setIntro(false)} />}
      <aside className="sidebar">
        <div className="brand drag">
          <Mark size={38} />
          <div className="brand-text">
            <Wordmark />
            <span className="tagline">OPEN SOURCE DOWNLOADER</span>
          </div>
        </div>

        <nav className="nav">
          {nav.map((item) => (
            <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}>
              <Icon name={item.icon} size={19} />
              {item.label}
              {!!item.badge && <span className="badge">{item.badge}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          {update.state === 'ready' && (
            <div className="update-card">
              <span>
                <strong>Waypoint {update.version}</strong> is ready to install.
              </span>
              <Button size="sm" variant="primary" icon="retry" onClick={installUpdate}>
                Restart to update
              </Button>
            </div>
          )}
          {SCENE_TAGLINE[settings.theme] && <div className="scene-tagline">{SCENE_TAGLINE[settings.theme]}</div>}
          <button className="theme-switch" onClick={cycleTheme} title="Switch theme">
            <Icon name="contrast" size={20} />
            <span>
              <small>Theme</small>
              <strong>{THEME_LABEL[settings.theme]}</strong>
            </span>
          </button>
          <div className="version-row">
            <span className="version">Waypoint v{__APP_VERSION__}</span>
            <button className="update-link" onClick={() => void run(api.checkForUpdates())} disabled={updateBusy} title="Check GitHub for a newer version">
              <Icon name="retry" size={13} className={update.state === 'checking' ? 'spin' : undefined} />
              {updateLabel}
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <ThemeScene
          theme={theme}
          bgUrl={snapshot.themeMedia[theme] ? `wptheme://theme/${theme}?v=${snapshot.themeMedia[theme]}` : null}
          dim={settings.sceneDim}
        />
        <header className="topbar drag">
          <h1>{TITLES[view]}</h1>
          <div className="stats">
            <div className="stat">
              <Icon name="activity" size={20} />
              <div>
                <div className="stat-value">{formatSpeed(snapshot.stats.speed)}</div>
                <div className="stat-label">Speed</div>
              </div>
            </div>
            <div className="stat">
              <Icon name="download" size={20} />
              <div>
                <div className="stat-value">{snapshot.stats.active}</div>
                <div className="stat-label">Active</div>
              </div>
            </div>
            <div className="stat">
              <Icon name="queue" size={20} />
              <div>
                <div className="stat-value">{snapshot.stats.queued}</div>
                <div className="stat-label">Queued</div>
              </div>
            </div>
            <div className="stat">
              <Icon name="database" size={20} />
              <div>
                <div className="stat-value">{snapshot.stats.total}</div>
                <div className="stat-label">Total</div>
              </div>
            </div>
          </div>
        </header>

        <div className="content">
          {view === 'grabber' && (
            <LinkGrabber
              snapshot={snapshot}
              api={api}
              run={run}
              pushToast={pushToast}
              onStartDownloads={(links) => links.length && setBatchLinks(links)}
              settings={settings}
              onOpenSettings={() => setView('settings')}
            />
          )}
          {view === 'downloads' && (
            <Downloads
              snapshot={snapshot}
              api={api}
              run={run}
              onGoToGrabber={() => setView('grabber')}
              deleteFilesDefault={settings.deleteFilesOnRemove}
              onRememberDeleteFiles={(v) => void saveSettings({ deleteFilesOnRemove: v })}
              onToast={(text) => pushToast({ kind: 'success', text })}
            />
          )}
          {view === 'themes' && (
            <ThemesView
              settings={settings}
              save={saveSettings}
              api={api}
              run={run}
              themeMedia={snapshot.themeMedia}
              onToast={(text) => pushToast({ kind: 'success', text })}
            />
          )}
          {view === 'settings' && (
            <SettingsView
              settings={settings}
              save={saveSettings}
              update={update}
              api={api}
              run={run}
              extensionConnected={snapshot.extensionConnected}
              resolving={snapshot.resolver.running}
              onToast={(text) => pushToast({ kind: 'success', text })}
            />
          )}
        </div>
      </main>

      {batchLinks && (
        <BatchDialog
          links={batchLinks}
          settings={settings}
          api={api}
          run={run}
          onClose={() => setBatchLinks(null)}
          onCreated={(batches) => {
            setBatchLinks(null)
            setView('downloads')
            pushToast({ kind: 'success', text: batches.length === 1 ? `Started "${batches[0].name}"` : `Started ${batches.length} batches` })
          }}
        />
      )}

      {clipboardOffer && (
        <ClipboardPrompt offer={clipboardOffer} api={api} run={run} onToast={(text) => pushToast({ kind: 'success', text })} onClose={clearClipboardOffer} />
      )}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
