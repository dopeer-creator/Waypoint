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
    // Keep the #fragment: some hosts put the file name there (host.example/abc123#Game.part1.rar).
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

/** File name carried in a link's #fragment, shown in the grabber until the resolver finds the real one. */
export function filenameHint(url: string): string | null {
  try {
    const fragment = decodeURIComponent(new URL(url).hash.slice(1))
    return /^[^/\\]+\.[a-z0-9]{2,5}$/i.test(fragment) ? sanitizeSegment(fragment) : null
  } catch {
    return null
  }
}

const RESERVED_NAMES =/^(con|prn|aux|nul|com\d|lpt\d)$/i

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

/** Endings that make a URL a file whatever the host is — archives, disc images, installers, media. */
const FILE_EXTENSION = /\.(?:rar|r\d{2}|zip|z\d{2}|7z|tar|t?gz|tbz2?|bz2|xz|iso|img|bin|cue|nrg|mds|exe|msi|apk|dmg|pkg|deb|mkv|mp4|avi|mov|wmv|m4v|webm|flac|mp3|m4a|wav|epub|cbz|cbr|pdf)$/i

/**
 * Hosts a download never comes from. Copying a link on one of these is ordinary browsing, and the prompt
 * appearing there is exactly what makes clipboard watching feel like nagging.
 */
const NEVER_A_FILE_HOST =
  /^(?:(?:[a-z0-9-]+\.)*(?:google\.[a-z.]+|gstatic\.com|youtube\.com|youtu\.be|github\.com|githubusercontent\.com|gitlab\.com|stackoverflow\.com|reddit\.com|redd\.it|twitter\.com|x\.com|t\.co|facebook\.com|instagram\.com|tiktok\.com|linkedin\.com|wikipedia\.org|wikimedia\.org|amazon\.[a-z.]+|ebay\.[a-z.]+|paypal\.com|microsoft\.com|live\.com|office\.com|apple\.com|netflix\.com|spotify\.com|discord\.(?:com|gg)|telegram\.(?:org|me)|t\.me|twitch\.tv|medium\.com|substack\.com|notion\.so|slack\.com|zoom\.us|claude\.ai|chatgpt\.com|openai\.com|anthropic\.com|steampowered\.com|steamcommunity\.com|epicgames\.com|gog\.com|nexusmods\.com|archive\.org|imgur\.com|pinterest\.[a-z.]+|quora\.com|bing\.com|duckduckgo\.com|yahoo\.com|news\.ycombinator\.com))$|^localhost$/i

/**
 * File hosts Waypoint expects to meet. These carry no file extension in the URL — a share link is an opaque
 * id — so the host name is the only thing that marks them as a download.
 */
const KNOWN_FILE_HOSTS = [
  'fuckingfast.co',
  'datanodes.to',
  'filekeeper.cc',
  'filekeeper.org',
  '1fichier.com',
  'rapidgator.net',
  'mega.nz',
  'mediafire.com',
  'gofile.io',
  'pixeldrain.com',
  'krakenfiles.com',
  'turbobit.net',
  'nitroflare.com',
  'hitfile.net',
  'uploadhaven.com',
  'bowfile.com',
  'send.cm',
  'sendspace.com',
  'zippyshare.com',
  'dropbox.com',
  'buzzheavier.com',
  'multiup.io',
  'katfile.com',
  'ddownload.com',
  'frdl.io',
  'filecrypt.cc',
  'qiwi.gg',
  'anonfiles.com',
  'workupload.com'
]

/**
 * Whether a copied URL is plausibly a file worth offering to download. The clipboard sees everything the user
 * copies all day, so the bar is a positive signal — a file name, a host we know, or a host they already use —
 * rather than "it parsed as a URL".
 *
 * `familiarHosts` are hosts already represented in the link list, which is what lets an unlisted host start
 * being offered once the user has added one of its links by hand.
 */
export function looksLikeDownload(url: string, familiarHosts: ReadonlySet<string> = new Set()): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
  if (!host || NEVER_A_FILE_HOST.test(host)) return false
  if (familiarHosts.has(host)) return true
  if (KNOWN_FILE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`))) return true
  if (filenameHint(url)) return true // host.example/abc123#Game.part1.rar
  try {
    return FILE_EXTENSION.test(decodeURIComponent(parsed.pathname))
  } catch {
    return FILE_EXTENSION.test(parsed.pathname)
  }
}
