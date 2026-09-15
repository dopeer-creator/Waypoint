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
  const add = async (resolve: boolean) => {
    const result = await run(api.addLinks(offer.text))
    if (result?.added && resolve) void run(api.resolverStart())
    if (result) onToast(result.added ? `Added ${plural(result.added, 'link')}` : 'No new links')
    onClose()
  }

  return (
    <Modal
      title="Links copied"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
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
          <div className="setting-desc">{offer.hosts.length ? `From ${offer.hosts.slice(0, 4).join(', ')}${offer.hosts.length > 4 ? '…' : ''}` : 'Copied links detected.'}</div>
        </div>
      </div>
    </Modal>
  )
}
