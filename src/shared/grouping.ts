export interface FileGroup {
  title: string
  ids: number[]
}

const VOLUME = /\.(part\d+\.rar|r\d{2,3}|z\d{2}|(zip|7z)\.\d{3}|zip|7z|rar|iso|bin|exe|msi|tar|gz)$/i
const TRAILING_EXT = /\.[a-z0-9]{2,5}$/i
const REPACKER_WORDS = /\b(fitgirl[\s-]?repacks?|dodi[\s-]?repacks?|elamigos|kaoskrew|repack(s)?|site|com|net|org)\b/gi
const EXTRA = /^(fg|dodi)[-_]|\b(optional|bonus|selective|soundtrack|ost|crack|update|patch|setup|dlc|hotfix)\b/i

/** Strips volume suffixes, repacker site tags, and separators to leave a readable application title. */
export function cleanTitle(name: string): string {
  let s = name.replace(VOLUME, '').replace(TRAILING_EXT, '')
  s = s.replace(/[_\-.\s]*--[_\-.\s]*/g, ' ') // _--_ site markers
  s = s.replace(REPACKER_WORDS, ' ')
  s = s.replace(/^(fg|dodi)[-_]+/i, '')
  s = s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s
}

/** Extras (soundtracks, crack, setup, fg- selective files) that belong with a game rather than forming their own batch. */
function isExtra(name: string): boolean {
  return EXTRA.test(name)
}

const tokens = (title: string): Set<string> =>
  new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
  )

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const t of a) if (b.has(t)) n++
  return n
}

/**
 * Clusters files into per-application groups: multi-part archives and same-title files land together, and extras
 * (soundtracks, cracks, fg- selective files) attach to the game they most resemble — or to the only game present.
 * The common case (one game per paste) returns a single group named after that game.
 */
export function groupFiles(items: { id: number; name: string }[]): FileGroup[] {
  const cleaned = items.map((it) => ({ id: it.id, title: cleanTitle(it.name) || it.name, extra: isExtra(it.name) }))
  const games = cleaned.filter((c) => !c.extra)
  const extras = cleaned.filter((c) => c.extra)

  // Group the real games by title.
  const groups = new Map<string, FileGroup>()
  const order: string[] = []
  for (const g of games) {
    const key = g.title.toLowerCase()
    let group = groups.get(key)
    if (!group) {
      group = { title: g.title, ids: [] }
      groups.set(key, group)
      order.push(key)
    }
    group.ids.push(g.id)
  }

  const list = order.map((k) => groups.get(k)!)

  if (list.length === 0) {
    // Everything looks like an "extra" (or a lone file): keep them together under the first title.
    return extras.length ? [{ title: cleaned[0]?.title || 'Batch', ids: cleaned.map((c) => c.id) }] : []
  }

  // Attach each extra to the best-matching game, or the only game.
  for (const extra of extras) {
    if (list.length === 1) {
      list[0].ids.push(extra.id)
      continue
    }
    const et = tokens(extra.title)
    let best = list[0]
    let bestScore = -1
    for (const group of list) {
      const score = overlap(et, tokens(group.title))
      if (score > bestScore) {
        bestScore = score
        best = group
      }
    }
    best.ids.push(extra.id)
  }

  return list
}
