// What the clipboard watcher will and won't offer.
//
// The watcher sees every copy the user makes all day, so this heuristic is the whole difference between a
// useful prompt and a nuisance. It runs against the real src/main/links.ts — esbuild strips the types, nothing
// is copied here — so a change to the rules shows up as a failure rather than as a surprise in the app.
//
//   node tests/clipboard-test.mjs
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = join(import.meta.dirname, '..')
const { transform } = createRequire(join(repo, 'package.json'))('esbuild')
const { code } = await transform(readFileSync(join(repo, 'src', 'main', 'links.ts'), 'utf8'), { loader: 'ts', format: 'esm' })
const out = join(mkdtempSync(join(tmpdir(), 'wp-links-')), 'links.mjs')
writeFileSync(out, code, 'utf8')
const { looksLikeDownload } = await import(pathToFileURL(out).href)

// A host the user has already added links from by hand. The watcher passes these in from the link list.
const familiar = new Set(['some-new-host.org'])

const cases = [
  // Should be offered.
  ['https://fuckingfast.co/7xvku91nl420#Game_.part1.rar', true, 'known host with a name in the fragment'],
  ['https://fuckingfast.co/7xvku91nl420', true, 'known host, opaque id'],
  ['https://datanodes.to/abc123def', true, 'known host'],
  ['https://www.mediafire.com/file/xyz/file', true, 'known host behind www'],
  ['https://dl3.example-cdn.net/files/Setup.part01.rar', true, 'unknown host, archive name'],
  ['https://files.example.com/downloads/ubuntu-24.04.iso', true, 'unknown host, disc image'],
  ['https://cdn.example.com/x/Movie%20Name.mkv', true, 'percent-encoded file name'],
  ['https://some-new-host.org/d/9f8a7b', true, 'host the user already has links from'],
  ['https://mirror.example.org/pack.r01', true, 'old-style rar volume'],

  // Should not be offered.
  ['https://github.com/dopeer-creator/Waypoint', false, 'ordinary browsing'],
  ['https://github.com/a/b/releases/download/v1/tool.zip', false, 'excluded host wins over the extension'],
  ['https://www.google.com/search?q=rar', false, 'search results'],
  ['https://youtube.com/watch?v=abc', false, 'video page'],
  ['https://claude.ai/chat/123', false, 'a chat link'],
  ['https://news.ycombinator.com/item?id=1', false, 'a forum'],
  ['https://example.com/about', false, 'a page on an unknown host with no file signal'],
  ['https://blog.example.com/2026/09/why-rar-is-fine', false, 'an article, no file'],
  ['http://localhost:5173/', false, 'a dev server'],
  ['not a url at all', false, 'not a URL']
]

let failed = 0
for (const [url, want, why] of cases) {
  const got = looksLikeDownload(url, familiar)
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${want ? 'offer ' : 'skip  '}  ${url}   (${why})`)
}

console.log(`\n${cases.length - failed}/${cases.length} passed`)
process.exit(failed ? 1 : 0)
