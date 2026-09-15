import type { WaypointApi } from '@shared/api'
import { THEMES, type ThemeInfo } from '@shared/themes'
import type { Settings, ThemeId } from '@shared/types'
import { Icon } from '../components/Icons'
import { Button } from '../components/ui'

interface Props {
  settings: Settings
  save: (patch: Partial<Settings>) => Promise<void>
  api: WaypointApi
  run: <T>(work: Promise<T>) => Promise<T | undefined>
  themeMedia: Record<string, number>
  onToast: (text: string) => void
}

function ThemeGrid({ themes, current, onPick }: { themes: ThemeInfo[]; current: ThemeId; onPick: (id: ThemeId) => void }) {
  return (
    <div className="theme-cards">
      {themes.map((t) => {
        const [bg, side, primary, line] = t.preview
        return (
          <button key={t.id} className={`theme-card ${current === t.id ? 'active' : ''}`} onClick={() => onPick(t.id)}>
            <div className="swatch" style={t.id === 'system' ? { background: `linear-gradient(135deg, ${bg} 50%, ${side} 50%)` } : { background: bg }}>
              <div style={{ background: t.id === 'system' ? 'transparent' : side }} />
              <div>
                <i style={{ background: primary, width: '70%' }} />
                <i style={{ background: line, width: '90%', opacity: 0.7 }} />
                <i style={{ background: line, width: '55%', opacity: 0.45 }} />
              </div>
            </div>
            <span className="theme-name">
              {t.label}
              {t.tagline && <small>{t.tagline}</small>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function ThemesView({ settings, save, api, run, themeMedia, onToast }: Props) {
  const destination = THEMES.find((t) => t.id === settings.theme && t.group === 'destination')
  const hasBackground = !!(destination && themeMedia[destination.id])

  return (
    <div className="settings">
      <div className="card section">
        <h2>Core themes</h2>
        <p className="section-note">Light, quick, and cycled from the theme button in the sidebar.</p>
        <ThemeGrid themes={THEMES.filter((t) => t.group === 'core')} current={settings.theme} onPick={(id) => save({ theme: id })} />

        <h2>Destination themes</h2>
        <p className="section-note">Animated worlds inspired by the destinations. Heavier than the core themes, so set here — the sidebar switch keeps to the core themes.</p>
        <ThemeGrid themes={THEMES.filter((t) => t.group === 'destination')} current={settings.theme} onPick={(id) => save({ theme: id })} />

        {destination && (
          <>
            <div className="setting top">
              <div className="setting-text">
                <div className="setting-label">Custom background for {destination.label}</div>
                <div className="setting-desc">
                  {hasBackground ? (
                    <span className="status-line ok">
                      <Icon name="checkCircle" size={14} /> Using your image. It stays on this PC and isn't shared.
                    </span>
                  ) : (
                    'Drop in your own wallpaper for a photoreal look. Images stay on this PC — nothing is uploaded or published.'
                  )}
                </div>
              </div>
              <div className="setting-control column">
                <Button
                  icon="folder"
                  onClick={async () => {
                    const set = await run(api.setThemeBackground(destination.id))
                    if (set) onToast(`${destination.label} background set`)
                  }}
                >
                  Choose image…
                </Button>
                <Button icon="external" onClick={() => run(api.openThemesFolder())}>
                  Open themes folder
                </Button>
                {hasBackground && (
                  <Button
                    variant="danger"
                    icon="trash"
                    onClick={async () => {
                      await run(api.clearThemeBackground(destination.id))
                      onToast('Background removed')
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <div className="setting">
              <div className="setting-text">
                <div className="setting-label">Background dimming</div>
                <div className="setting-desc">How much to darken a custom background so text stays readable.</div>
              </div>
              <div className="setting-control">
                <input
                  className="range"
                  type="range"
                  min={0}
                  max={90}
                  value={settings.sceneDim}
                  aria-label="Background dimming"
                  onChange={(e) => save({ sceneDim: Number(e.target.value) })}
                />
                <span className="unit">{settings.sceneDim}%</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
