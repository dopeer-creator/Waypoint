import { useState } from 'react'
import type { ResolveMode } from '@shared/types'
import { Icon } from './Icons'
import { Button, Modal } from './ui'

export const MODES_README = 'https://github.com/dopeer-creator/Waypoint#resolve-modes'

interface Props {
  mode: ResolveMode
  /** Opened just before a resolve starts, so the primary button carries on with it. */
  starting: boolean
  extensionConnected: boolean
  /** The remembered "Don't show again", which is where the checkbox starts. */
  hidden: boolean
  onSwitchMode: (mode: ResolveMode) => void
  onHide: (hidden: boolean) => void
  onStart: () => void
  onOpenSettings: () => void
  onClose: () => void
}

/**
 * The short "how this works" for the resolve modes. It exists because automatic mode opens real Chrome tabs in
 * front of the user, and someone who hasn't been told will start clicking in them — which lands on ads and
 * derails the link. Kept to a glance: what happens, what to do, what not to do.
 */
export function ModeGuide({ mode, starting, extensionConnected, hidden, onSwitchMode, onHide, onStart, onOpenSettings, onClose }: Props) {
  const [dontShow, setDontShow] = useState(hidden)
  const auto = mode === 'automated'

  const finish = (then?: () => void) => {
    if (dontShow !== hidden) onHide(dontShow)
    onClose()
    then?.()
  }

  const footer = (
    <>
      <label className="guide-check">
        <input type="checkbox" className="check" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
        Don't show again
      </label>
      <span className="spacer" />
      {auto ? (
        <>
          <Button variant="ghost" onClick={() => onSwitchMode('handoff')}>
            Use my browser instead
          </Button>
          <Button variant="primary" icon={starting ? 'play' : undefined} onClick={() => finish(starting ? onStart : undefined)}>
            {starting ? 'Got it — start' : 'Got it'}
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={() => onSwitchMode('automated')}>
            Back to automatic
          </Button>
          {extensionConnected ? (
            <Button variant="primary" icon={starting ? 'play' : undefined} onClick={() => finish(starting ? onStart : undefined)}>
              {starting ? 'Start resolving' : 'Got it'}
            </Button>
          ) : (
            <Button variant="primary" icon="sliders" onClick={() => finish(onOpenSettings)}>
              Set up the extension
            </Button>
          )}
        </>
      )}
    </>
  )

  return (
    <Modal title={auto ? 'How automatic mode works' : 'How "In your browser" mode works'} onClose={() => finish()} footer={footer}>
      {auto ? (
        <ul className="guide">
          <li>
            <Icon name="play" size={16} />
            <span>
              Waypoint opens each link in <strong>its own Chrome window</strong> and clicks through to the download
              for you. Several tabs work at once.
            </span>
          </li>
          <li className="warn">
            <Icon name="alert" size={16} />
            <span>
              <strong>Don't click inside those tabs, and don't close them.</strong> A stray click can land on an ad
              and throw a link off. Leave them be — they close themselves.
            </span>
          </li>
          <li>
            <Icon name="checkCircle" size={16} />
            <span>
              You're only needed when a tab <strong>comes to the front asking for a Cloudflare check</strong>. Complete
              the check, then let go again.
            </span>
          </li>
          <li className="aside">
            <Icon name="external" size={16} />
            <span>
              Rather do it by hand? <strong>In your browser</strong> mode opens the links as normal tabs in your own
              browser, and you click Download yourself.
            </span>
          </li>
        </ul>
      ) : (
        <ul className="guide">
          <li>
            <Icon name="external" size={16} />
            <span>
              Links open as <strong>normal tabs in your own browser</strong>, with your usual logins and cookies.
            </span>
          </li>
          <li>
            <Icon name="checkCircle" size={16} />
            <span>
              In each tab, pass any check and <strong>click Download</strong> as you normally would.
            </span>
          </li>
          <li>
            <Icon name="download" size={16} />
            <span>
              The <strong>Waypoint extension</strong> catches the download and hands it to Waypoint, which fetches it
              — your browser doesn't keep a copy.
            </span>
          </li>
          <li className={extensionConnected ? '' : 'warn'}>
            <Icon name={extensionConnected ? 'checkCircle' : 'alert'} size={16} />
            <span>
              {extensionConnected ? (
                'The extension is connected, so you are ready to go.'
              ) : (
                <>
                  <strong>The extension isn't installed yet.</strong> It takes a minute, once — Settings walks you
                  through it.
                </>
              )}
            </span>
          </li>
        </ul>
      )}
    </Modal>
  )
}
