import type { WaypointApi } from '@shared/api'
import type { ClipboardOffer } from '@shared/types'
import { plural } from '../lib/format'
import { Icon } from './Icons'
import { Button, Modal } from './ui'

interface Props {
  offer: ClipboardOffer
  api: WaypointApi
  run: <T>(work: Promise<T>) => Promise<T | undefined>
  onToast: (text: string) => void
  onClose: () => void
}

/** Asks before adding links spotted on the clipboard (JDownloader-style, but with consent). */
export function ClipboardPrompt({ offer, api, run, onToast, onClose }: Props) {
  const hostList = offer.hosts.slice(0, 4).join(', ') + (offer.hosts.length > 4 ? '…' : '')

  // Every way out answers, so the watcher knows the prompt is gone and what not to offer again.
  const close = (added: boolean, ignoreHosts = false) => {
    void api.clipboardAnswer({ text: offer.text, added, ignoreHosts })
    onClose()
  }

  const add = async (resolve: boolean) => {
    const result = await run(api.addLinks(offer.text))
    if (result?.added && resolve) void run(api.resolverStart())
    if (result) onToast(result.added ? `Added ${plural(result.added, 'link')}` : 'No new links')
    close(Boolean(result?.added))
  }

  const mute = () => {
    close(false, true)
    onToast(offer.hosts.length === 1 ? `Won't ask about ${offer.hosts[0]} again` : "Won't ask about those hosts again")
  }

  return (
    <Modal
      title="Links copied"
      onClose={() => close(false)}
      footer={
        <>
          {offer.hosts.length > 0 && (
            <Button variant="ghost" onClick={mute}>
              Never {offer.hosts.length === 1 ? `for ${offer.hosts[0]}` : 'for these hosts'}
            </Button>
          )}
          <Button variant="ghost" onClick={() => close(false)}>
            Not now
          </Button>
          <span className="spacer" />
          <Button icon="grabber" onClick={() => add(false)}>
            Add
          </Button>
          <Button variant="primary" icon="play" onClick={() => add(true)}>
            Add &amp; resolve
          </Button>
        </>
      }
    >
      <div className="switch-row">
        <Icon name="link" size={20} />
        <div className="setting-text">
          <div className="setting-label">Add {plural(offer.count, 'link')} from the clipboard?</div>
          <div className="setting-desc">{hostList ? `From ${hostList}` : 'Copied links detected.'}</div>
        </div>
      </div>
    </Modal>
  )
}
