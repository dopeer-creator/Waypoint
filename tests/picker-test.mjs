/**
 * Regression test for the resolver's download-button picker.
 *
 *   npm run test:picker
 *
 * Each fixture in ./fixtures is a local stand-in for a real host's download page — same button labels, same
 * steps, same countdown, plus the ad decoys and paid upsells those pages carry. The test loads them in Chrome,
 * pulls FIND_DOWNLOAD_SCRIPT straight out of src/main/resolver/generic.ts (never a copy — a copy would rot),
 * and replays the resolver's own loop: POLL_MS between looks, CLICK_COOLDOWN_MS between clicks, MAX_AUTO_CLICKS
 * in total, all read from resolver.ts.
 *
 * Run it before and after changing the picker. A host is only "supported" when the hosts that already worked
 * still click the same controls in the same order.
 */
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const require = createRequire(join(REPO, 'package.json'))
const { chromium } = require('patchright-core')

const generic = readFileSync(join(REPO, 'src/main/resolver/generic.ts'), 'utf8')
const resolver = readFileSync(join(REPO, 'src/main/resolver/resolver.ts'), 'utf8')

const num = (name) => Number(resolver.match(new RegExp(`const ${name} = ([0-9]+)`))[1])
const MAX_AUTO_CLICKS = num('MAX_AUTO_CLICKS')
const CLICK_COOLDOWN_MS = num('CLICK_COOLDOWN_MS')
const POLL_MS = num('POLL_MS')

/** Lifts a browser-side script out of generic.ts so the test always runs the shipping picker. */
function extract(name) {
  const start = generic.indexOf(`const ${name} = \``)
  if (start < 0) throw new Error(`not found in generic.ts: ${name}`)
  const from = generic.indexOf('`', start) + 1
  const to = generic.indexOf('`', from)
  const raw = generic.slice(from, to)
  if (raw.includes('${')) throw new Error(`${name} now interpolates; this extractor can't handle that`)
  return eval('`' + raw + '`')
}

const FIND = extract('FIND_DOWNLOAD_SCRIPT')
const MARK = extract('MARK_CLICKED_SCRIPT')

const DESCRIBE = `(() => {
  const el = document.querySelector('[data-waypoint-target]');
  if (!el) return null;
  const raw = (el.innerText || el.textContent || el.value || '').trim();
  return { tag: el.tagName.toLowerCase(), href: el.getAttribute('href') || '', label: raw.replace(/\\s+/g, ' ').slice(0, 60) };
})()`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Served over HTTP, not file://. On file:// location.hostname is '', and the picker's same-site test
// (u.hostname.endsWith(site)) then matches every host — the ad decoys would sail through and the test would
// report behaviour the real app never has.
const server = createServer((req, res) => {
  const name = (req.url ?? '/').split('?')[0].replace(/^\//, '')
  try {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(readFileSync(join(HERE, 'fixtures', name)))
  } catch {
    res.writeHead(404).end('no such fixture')
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const ORIGIN = `http://localhost:${server.address().port}`

async function run(browser, fixture, budgetMs) {
  const page = await browser.newPage()
  await page.goto(`${ORIGIN}/${fixture}`)

  const picked = []
  const started = Date.now()
  let clicks = 0
  let lastClick = 0

  while (Date.now() - started < budgetMs && clicks < MAX_AUTO_CLICKS) {
    await sleep(POLL_MS)
    if (await page.evaluate(`document.documentElement.dataset.downloaded === '1'`)) break
    if (Date.now() - lastClick <= CLICK_COOLDOWN_MS) continue

    const found = await page.evaluate(FIND)
    if (!found) continue

    const what = await page.evaluate(DESCRIBE)
    try {
      await page.click('[data-waypoint-target]', { timeout: 3000 })
    } catch {
      continue
    }
    await page.evaluate(MARK).catch(() => undefined)
    clicks++
    lastClick = Date.now()
    picked.push(what)
  }

  // Fixtures report through the DOM, not window: patchright's page.evaluate runs in an isolated world and
  // cannot see page globals, but both worlds share the DOM.
  const out = await page.evaluate(`(() => {
    const d = document.documentElement.dataset;
    return {
      downloaded: d.downloaded === '1',
      boughtPremium: d.boughtPremium === '1',
      clickedTooEarly: d.clickedTooEarly === '1',
      step: d.step || ''
    };
  })()`)
  await page.close()
  return { picked, clicks, ...out, seconds: Math.round((Date.now() - started) / 100) / 10 }
}

const FIXTURES = [
  { file: 'twoclick.html', host: 'fuckingfast-shaped', budgetMs: 25000 },
  { file: 'multistep.html', host: 'datanodes-shaped', budgetMs: 30000 },
  { file: 'countdown.html', host: 'filekeeper-shaped', budgetMs: 25000 }
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
console.log(`picker replay · MAX_AUTO_CLICKS=${MAX_AUTO_CLICKS} CLICK_COOLDOWN_MS=${CLICK_COOLDOWN_MS} POLL_MS=${POLL_MS}\n`)

let failed = 0
for (const { file, host, budgetMs } of FIXTURES) {
  const r = await run(browser, file, budgetMs)
  const bad = !r.downloaded || r.boughtPremium || r.clickedTooEarly
  if (bad) failed++

  console.log(`${r.downloaded ? 'PASS' : 'FAIL'}  ${file}  (${host})  ${r.clicks} click${r.clicks === 1 ? '' : 's'}, ${r.seconds}s`)
  if (r.boughtPremium) console.log('      FAIL: clicked a paid control')
  if (r.clickedTooEarly) console.log('      FAIL: clicked the countdown before it armed')
  if (!r.downloaded && r.step) console.log(`      stalled at step: ${r.step}`)
  if (!r.picked.length) console.log('      (found nothing to click)')
  for (const [i, p] of r.picked.entries()) {
    console.log(`      ${i + 1}. <${p.tag}> "${p.label}"${p.href ? ` href=${p.href}` : ''}`)
  }
  console.log()
}

await browser.close()
server.close()

if (failed) {
  console.log(`${failed} of ${FIXTURES.length} fixtures failed`)
  process.exit(1)
}
console.log(`all ${FIXTURES.length} fixtures passed`)
