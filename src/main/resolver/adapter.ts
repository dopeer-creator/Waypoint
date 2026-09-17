import type { Page } from 'patchright'

export type VerificationState =
  /** Full-page Cloudflare interstitial ("Just a moment..."). */
  | 'challenge-page'
  /** Turnstile widget on the page, not solved yet. */
  | 'unsolved'
  | 'solved'
  /** No Cloudflare challenge on this page. */
  | 'none'

/**
 * Per-host behaviour for the resolver. Put host quirks here instead of in the resolver loop.
 * Adapters are tried in order; the generic adapter is the fallback for every URL.
 */
export interface HostAdapter {
  id: string
  match(url: URL): boolean
  verificationState(page: Page): Promise<VerificationState>
  /**
   * Tries to start the file download on the current page (e.g. clicks the host's download button).
   * Return a short description of what was clicked, or null if nothing was. The resolver logs the
   * description — on an unfamiliar host it's the only way to see whether it hit the real control or a
   * decoy — and captures the resulting browser download.
   */
  triggerDownload(page: Page): Promise<string | null>
  /** Caps aria2 connections per file for hosts that throttle or ban parallel connections. */
  maxConnections?: number
}
