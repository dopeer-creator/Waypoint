const URL_PATTERN = /https?:\/\/[^\s"'<>`]+/gi
const TRAILING_JUNK = /[)\].,;:!?'"]+$/

/** Pulls every http(s) URL out of arbitrary pasted text, JDownloader-style. Returns unique, valid URLs in paste order. */
export function extractUrls(text: string): { urls: string[]; invalid: number } {
  const seen = new Set<string>()
  const urls: string[] = []
  let invalid = 0

  for (const match of text.match(URL_PATTERN) ?? []) {
    const candidate = match.replace(TRAILING_JUNK, '')
    let parsed: URL
    try {
      parsed = new URL(candidate)
    } catch {
      invalid++
      continue
    }
    if (!parsed.hostname.includes('.')) {
      invalid++
      continue
    }
    parsed.hash = ''
    const normalized = parsed.toString()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    urls.push(normalized)
  }

  // Non-empty lines that held no URL at all count as invalid input.
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() && !/https?:\/\//i.test(line)) invalid++
  }

  return { urls, invalid }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i

/** Makes a string safe as a single Windows path segment. */
export function sanitizeSegment(name: string, fallback = 'download'): string {
  let clean = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  if (RESERVED_NAMES.test(clean.split('.')[0] ?? '')) clean = `_${clean}`
  if (clean.length > 150) {
    const dot = clean.lastIndexOf('.')
    const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : ''
    clean = clean.slice(0, 150 - ext.length) + ext
  }
  return clean || fallback
}
