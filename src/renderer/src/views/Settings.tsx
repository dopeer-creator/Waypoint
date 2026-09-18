import { useEffect, useState, type ReactNode } from 'react'
import type { WaypointApi } from '@shared/api'
import type { EnvInfo, HandoffBrowser, Settings, UpdateState } from '@shared/types'
import { Icon } from '../components/Icons'
import { Button, Modal, NumberInput, Toggle } from '../components/ui'

interface Props {
  settings: Settings
  save: (patch: Partial<Settings>) => Promise<void>
  update: UpdateState
  api: WaypointApi
  run: <T>(work: Promise<T>) => Promise<T | undefined>
  extensionConnected: boolean
  /** A resolve run is in progress — resetting would change its settings underneath it. */
  resolving: boolean
  onToast: (text: string) => void
  /** The resolve mode was switched here — App explains what changed. */
  onModeChanged: (mode: 'handoff' | 'automated') => void
  onShowGuide: () => void
}

const HANDOFF_LABEL: Record<HandoffBrowser, string> = { brave: 'Brave', chrome: 'Chrome', edge: 'Edge', default: 'Default' }
const EXTENSIONS_PAGE: Record<HandoffBrowser, string> = {
  brave: 'brave://extensions',
  chrome: 'chrome://extensions',
  edge: 'edge://extensions',
  default: 'chrome://extensions'
}

function Row({ label, desc, children }: { label: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <div className="setting-label">{label}</div>
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function updateText(update: UpdateState, version: string): string {
  switch (update.state) {
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return `Version ${update.version} found, downloading…`
    case 'downloading':
      return `Downloading ${update.version} — ${update.percent}%`
    case 'ready':
      return `Version ${update.version} is ready. It installs when you quit, or restart now.`
    case 'error':
      return `Update check failed: ${update.message}`
    case 'none':
      return `You're on the latest version (${version}).`
    default:
      return `Version ${version}. Updates come from GitHub Releases.`
  }
}

export function SettingsView({ settings, save, update, api, run, extensionConnected, resolving, onToast, onModeChanged, onShowGuide }: Props) {
  const [env, setEnv] = useState<EnvInfo | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [winrarDraft, setWinrarDraft] = useState(settings.winrarPath)
  const handoff = settings.resolveMode === 'handoff'
  const browserName = settings.handoffBrowser === 'default' ? 'your browser' : HANDOFF_LABEL[settings.handoffBrowser]

  useEffect(() => {
    void api.getEnvironment().then(setEnv)
  }, [api, settings.winrarPath, extensionConnected])

  const browseFolder = async () => {
    const folder = await run(api.pickFolder(settings.baseFolder))
    if (folder) await save({ baseFolder: folder })
  }

  const resetProfile = async () => {
    const ok = confirm(
      'Reset the resolver browser profile?\n\nThis deletes the cookies and history Waypoint\'s browser has built up. Cloudflare checks may need manual clicks more often until it builds trust again. This cannot be undone.'
    )
    if (!ok) return
    const done = await run(api.resetBrowserProfile().then(() => true))
    if (done) onToast('Browser profile reset')
  }

  const copy = async (text: string, what: string) => {
    const done = await run(api.copyText(text).then(() => true))
    if (done) onToast(`${what} copied`)
  }

  const version = env?.version ?? '…'

  return (
    <div className="settings">
      <div className="card section">
        <h2>Downloads</h2>
        <Row label="Default folder" desc="Each batch gets its own subfolder here. The last folder you use is remembered.">
          <input className="input path-input" value={settings.baseFolder} readOnly />
          <Button icon="folder" onClick={browseFolder}>
            Browse
          </Button>
        </Row>
        <Row label="Simultaneous downloads" desc="Files downloading at once. The rest wait in the queue.">
          <NumberInput label="Simultaneous downloads" value={settings.maxConcurrent} min={1} max={16} onCommit={(n) => save({ maxConcurrent: n })} />
          <span className="unit">files</span>
        </Row>
        <Row label="Connections per file" desc="Parallel chunks per file. Some free hosts limit this — per-host limits in adapters take priority.">
          <NumberInput label="Connections per file" value={settings.connectionsPerFile} min={1} max={16} onCommit={(n) => save({ connectionsPerFile: n })} />
          <span className="unit">conns</span>
        </Row>
        <Row label="Speed limit" desc="Total download speed cap. 0 means unlimited.">
          <NumberInput label="Speed limit" value={settings.speedLimitKib} min={0} max={10_000_000} onCommit={(n) => save({ speedLimitKib: n })} />
          <span className="unit">KB/s</span>
        </Row>
      </div>

      <div className="card section">
        <h2>Link resolving</h2>
        <Row
          label="Resolve links"
          desc={
            handoff
              ? 'Links open as normal tabs in your own browser. You pass any Cloudflare check yourself and click Download; the Waypoint extension hands the file to Waypoint.'
              : 'Waypoint opens each link in its own Chrome/Edge window and clicks the download button for you. You complete any Cloudflare check in that window.'
          }
        >
          <div className="segmented">
            <button className={handoff ? 'active' : ''} onClick={() => !handoff && void save({ resolveMode: 'handoff' }).then(() => onModeChanged('handoff'))}>
              In your browser
            </button>
            <button className={handoff ? '' : 'active'} onClick={() => handoff && void save({ resolveMode: 'automated' }).then(() => onModeChanged('automated'))}>
              Automatic
            </button>
          </div>
          <Button variant="ghost" size="sm" icon="info" onClick={onShowGuide}>
            How it works
          </Button>
        </Row>

        {handoff ? (
          <>
            <Row label="Open links in" desc="Your normal browser session, with your logins and cookies. The browser needs the Waypoint extension below.">
              <div className="segmented">
                {(['brave', 'chrome', 'edge', 'default'] as const).map((browser) => (
                  <button
                    key={browser}
                    className={settings.handoffBrowser === browser ? 'active' : ''}
                    disabled={!!env && !env.handoffBrowsers.includes(browser)}
                    onClick={() => save({ handoffBrowser: browser })}
                  >
                    {HANDOFF_LABEL[browser]}
                  </button>
                ))}
              </div>
            </Row>
            <div className="setting top">
              <div className="setting-text">
                <div className="setting-label">Browser extension</div>
                <div className="setting-desc">
                  {extensionConnected ? (
                    <span className="status-line ok">
                      <Icon name="checkCircle" size={14} /> Connected{env?.extensionVersion ? ` (v${env.extensionVersion})` : ''}
                    </span>
                  ) : (
                    <span className="status-line bad">
                      <Icon name="alert" size={14} /> Not connected. Install it in {browserName} once:
                    </span>
                  )}
                </div>
                <ol className="steps">
                  <li>
                    Click <strong>Copy page address</strong>, paste it into {browserName}'s address bar and press Enter.
                  </li>
                  <li>
                    Turn on <strong>Developer mode</strong>.
                  </li>
                  <li>
                    Click <strong>Load unpacked</strong> and choose this folder (<strong>Copy folder path</strong> and paste it into the folder box):
                  </li>
                </ol>
                {env && <span className="path-chip">{env.extensionFolder}</span>}
                <div className="setting-desc">
                  The extension only acts while Waypoint is resolving a link, and only on downloads from that link's site. Other downloads stay in the
                  browser.
                </div>
              </div>
              <div className="setting-control column">
                <Button icon="link" onClick={() => copy(EXTENSIONS_PAGE[settings.handoffBrowser], 'Page address')}>
                  Copy page address
                </Button>
                <Button icon="file" onClick={() => env && copy(env.extensionFolder, 'Folder path')} disabled={!env}>
                  Copy folder path
                </Button>
                <Button icon="folder" onClick={() => run(api.openExtensionFolder())}>
                  Open folder
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <Row label="Browser" desc="Waypoint drives your installed browser with its own separate profile, so your normal browsing isn't touched.">
              <div className="segmented">
                {(['chrome', 'msedge'] as const).map((channel) => (
                  <button
                    key={channel}
                    className={settings.browserChannel === channel ? 'active' : ''}
                    disabled={!!env && !env.browsers.includes(channel)}
                    onClick={() => save({ browserChannel: channel })}
                  >
                    {channel === 'chrome' ? 'Chrome' : 'Edge'}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Auto-click download buttons" desc="After verification, click the most likely download button. Turn off to always click it yourself.">
              <Toggle label="Auto-click download buttons" checked={settings.autoClickDownload} onChange={(v) => save({ autoClickDownload: v })} />
            </Row>
            <Row label="Reset browser profile" desc="Clears the resolver browser's cookies and history.">
              <Button variant="danger" icon="trash" onClick={resetProfile}>
                Reset
              </Button>
            </Row>
          </>
        )}

        <Row label="Time limit per link" desc="How long to wait on one link, including the check and clicking Download, before marking it failed.">
          <NumberInput label="Time limit per link" value={settings.resolveTimeoutSec} min={30} max={3600} onCommit={(n) => save({ resolveTimeoutSec: n })} />
          <span className="unit">sec</span>
        </Row>
        <Row label="Refresh attempts" desc="How many times an expired download link is re-resolved before the file is marked failed.">
          <NumberInput label="Refresh attempts" value={settings.maxResolveAttempts} min={1} max={10} onCommit={(n) => save({ maxResolveAttempts: n })} />
          <span className="unit">tries</span>
        </Row>
      </div>

      <div className="card section">
        <h2>Extraction</h2>
        <Row
          label="WinRAR"
          desc={
            env?.winrarPath ? (
              <span className="status-line ok">
                <Icon name="checkCircle" size={14} /> {env.winrarPath}
              </span>
            ) : (
              <span className="status-line bad">
                <Icon name="alert" size={14} /> {env ? 'Not found. Install WinRAR or enter the path to WinRAR.exe.' : 'Checking…'}
              </span>
            )
          }
        >
          <input
            className="input path-input"
            placeholder="Auto-detect"
            value={winrarDraft}
            onChange={(e) => setWinrarDraft(e.target.value)}
            onBlur={() => winrarDraft !== settings.winrarPath && save({ winrarPath: winrarDraft.trim() })}
          />
        </Row>
        <Row label="Delete archives after extract" desc="Default for new batches: remove the original .rar/.zip files once a set extracts cleanly. Each batch can override this.">
          <Toggle label="Delete archives after extract" checked={settings.deleteArchivesAfterExtract} onChange={(v) => save({ deleteArchivesAfterExtract: v })} />
        </Row>
      </div>

      <div className="card section">
        <h2>Behaviour</h2>
        <Row label="Watch clipboard" desc="When you copy links anywhere, Waypoint asks whether to add them.">
          <Toggle label="Watch clipboard" checked={settings.clipboardWatch} onChange={(v) => save({ clipboardWatch: v })} />
        </Row>
        {settings.clipboardIgnoreHosts.length > 0 && (
          <Row
            label="Muted hosts"
            desc={`Never offered from ${settings.clipboardIgnoreHosts.slice(0, 3).join(', ')}${settings.clipboardIgnoreHosts.length > 3 ? ` and ${settings.clipboardIgnoreHosts.length - 3} more` : ''}.`}
          >
            <Button icon="x" onClick={() => void save({ clipboardIgnoreHosts: [] })}>
              Unmute all
            </Button>
          </Row>
        )}
        <Row
          label="Save speed history"
          desc="Keeps a per-minute record of download speed in a folder on this PC, so past days can be opened from the speed graph. Nothing leaves your computer; the last 30 days are kept."
        >
          {settings.saveSpeedHistory && (
            <Button icon="folder" onClick={() => run(api.openSpeedHistoryFolder())}>
              Open folder
            </Button>
          )}
          <Toggle label="Save speed history" checked={settings.saveSpeedHistory} onChange={(v) => save({ saveSpeedHistory: v })} />
        </Row>
        <Row label="Close to tray" desc="Closing the window keeps Waypoint running in the system tray.">
          <Toggle label="Close to tray" checked={settings.closeToTray} onChange={(v) => save({ closeToTray: v })} />
        </Row>
        <Row
          label="Reset to defaults"
          desc={resolving ? 'Stop resolving first — a reset would change the run’s settings underneath it.' : 'Puts every setting on this page back to how Waypoint ships.'}
        >
          <Button variant="danger" icon="retry" disabled={resolving} onClick={() => setConfirmReset(true)}>
            Reset all
          </Button>
        </Row>
      </div>

      <div className="card section">
        <h2>About</h2>
        <Row label="Updates" desc={updateText(update, version)}>
          {update.state === 'ready' ? (
            <Button variant="primary" icon="retry" onClick={() => run(api.installUpdate())}>
              Restart now
            </Button>
          ) : (
            <Button icon="retry" onClick={() => run(api.checkForUpdates())} disabled={update.state === 'checking' || update.state === 'downloading'}>
              Check now
            </Button>
          )}
        </Row>
        <Row label="Download engine" desc={env?.aria2Ready ? `aria2 ${env.aria2Version} running` : 'aria2 is not running — check the logs'}>
          <Button icon="file" onClick={() => run(api.openLogs())}>
            Open logs
          </Button>
        </Row>
        <Row label="Source code" desc="Waypoint is open source. Report issues and follow releases on GitHub.">
          <Button icon="external" onClick={() => window.open('https://github.com/dopeer-creator/Waypoint')}>
            GitHub
          </Button>
        </Row>
      </div>

      {confirmReset && (
        <Modal
          title="Reset every setting?"
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                Cancel
              </Button>
              <span className="spacer" />
              <Button
                variant="danger"
                icon="retry"
                onClick={async () => {
                  const next = await run(api.resetSettings())
                  setConfirmReset(false)
                  if (next) {
                    setWinrarDraft(next.winrarPath)
                    onToast('Settings reset to defaults')
                  }
                }}
              >
                Reset everything
              </Button>
            </>
          }
        >
          <p className="muted">Every preference goes back to how Waypoint ships. That includes ones you may have set deliberately:</p>
          <ul className="muted">
            <li>
              Download folder — <code>{settings.baseFolder}</code> goes back to your Windows Downloads folder
            </li>
            <li>WinRAR path, browser choice, and resolve mode</li>
            <li>Speed limit, concurrency, and connections per file</li>
            <li>Theme, and the hosts you muted on the clipboard</li>
          </ul>
          <p className="muted">Your links, batches, and downloaded files are not touched.</p>
        </Modal>
      )}
    </div>
  )
}
