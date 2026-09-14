import type { HostAdapter } from './adapter'
import { genericAdapter } from './generic'

/**
 * Host-specific adapters, checked in order before the generic fallback.
 * To add a host, create a file next to this one that exports a HostAdapter and list it here, e.g.:
 *
 *   export const exampleHost: HostAdapter = {
 *     ...genericAdapter,
 *     id: 'example-host',
 *     match: (url) => url.hostname.endsWith('example-host.com'),
 *     maxConnections: 1,
 *     triggerDownload: async (page) => {
 *       const button = page.locator('#download-button:not([disabled])')
 *       if (!(await button.isVisible())) return false
 *       await button.click()
 *       return true
 *     }
 *   }
 */
const hostAdapters: HostAdapter[] = []

export function adapterFor(url: string): HostAdapter {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return genericAdapter
  }
  return hostAdapters.find((a) => a.match(parsed)) ?? genericAdapter
}
