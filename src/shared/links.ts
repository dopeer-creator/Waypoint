const ENTITIES: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>' }

/**
 * Link targets from an HTML fragment. Copying link text from a web page puts only the visible text
 * (e.g. file names) in the plain-text clipboard; the real URLs live in the HTML flavour's href attributes.
 */
export function hrefsFromHtml(html: string): string[] {
  if (!html) return []
  const seen = new Set<string>()
  for (const match of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = (match[1] ?? match[2] ?? match[3] ?? '')
      .trim()
      .replace(/&(amp|quot|#39|apos|lt|gt);/g, (entity) => ENTITIES[entity] ?? entity)
    if (/^https?:\/\//i.test(href)) seen.add(href)
  }
  return [...seen]
}
