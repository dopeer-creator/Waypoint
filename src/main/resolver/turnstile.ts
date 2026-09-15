import log from 'electron-log/main'
import type { BrowserContext, Page } from 'patchright'

export interface TurnstileParams {
  sitekey: string
  action: string | null
  cdata: string | null
}

const MAX_CLICK_ATTEMPTS = 10
const CLICK_INTERVAL_MS = 500

/** Minimal page with a Turnstile widget, matching Turnstile-Solver's HTML template. */
const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Turnstile Solver</title>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head>
<body>
  <!-- cf turnstile -->
</body>
</html>`

const EXTRACT_PARAMS_SCRIPT = `(() => {
  const pick = (el) => ({
    sitekey: el.getAttribute('data-sitekey') || '',
    action: el.getAttribute('data-action') || null,
    cdata: el.getAttribute('data-cdata') || null
  })
  const widget = document.querySelector('.cf-turnstile[data-sitekey], [data-sitekey].cf-turnstile, [data-sitekey]')
  if (widget) {
    const p = pick(widget)
    if (p.sitekey) return p
  }
  const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]')
  if (iframe) {
    try {
      const u = new URL(iframe.src)
      const sitekey = u.searchParams.get('k') || u.pathname.split('/').filter(Boolean).pop() || ''
      if (sitekey) return { sitekey, action: u.searchParams.get('action'), cdata: u.searchParams.get('cdata') }
    } catch {}
  }
  return null
})()`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function turnstileDiv(params: TurnstileParams): string {
  const attrs = [`class="cf-turnstile"`, `data-sitekey="${params.sitekey}"`]
  if (params.action) attrs.push(`data-action="${params.action}"`)
  if (params.cdata) attrs.push(`data-cdata="${params.cdata}"`)
  return `<div ${attrs.join(' ')}></div>`
}

export async function extractParams(page: Page): Promise<TurnstileParams | null> {
  try {
    return (await page.evaluate(EXTRACT_PARAMS_SCRIPT)) as TurnstileParams | null
  } catch {
    return null
  }
}

/** Click the Turnstile widget on the current page (Turnstile-Solver approach). */
export async function clickWidget(page: Page): Promise<void> {
  const widget = page.locator('.cf-turnstile, [data-sitekey].cf-turnstile').first()
  if (await widget.count()) {
    await widget.click({ timeout: 3000 }).catch(() => undefined)
    return
  }
  const iframe = page.frameLocator('iframe[src*="challenges.cloudflare.com"]').first()
  await iframe.locator('body').click({ timeout: 3000, position: { x: 25, y: 25 } }).catch(() => undefined)
}

/** Inject a solved token into hidden inputs on the host page and fire change events. */
export async function injectToken(page: Page, token: string): Promise<void> {
  await page.evaluate((value) => {
    for (const input of document.querySelectorAll('input[name="cf-turnstile-response"]')) {
      const el = input as HTMLInputElement
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const form = document.querySelector('form')
    if (form) form.dispatchEvent(new Event('input', { bubbles: true }))
  }, token)
}

/**
 * Opens a synthetic page at the same URL with only a Turnstile widget, solves it with patchright,
 * and returns the token. Based on Theyka/Turnstile-Solver.
 */
export async function solveSynthetic(context: BrowserContext, url: string, params: TurnstileParams): Promise<string | null> {
  const page = await context.newPage()
  try {
    const urlWithSlash = url.endsWith('/') ? url : `${url}/`
    const pageData = HTML_TEMPLATE.replace('<!-- cf turnstile -->', turnstileDiv(params))

    await page.route(urlWithSlash, (route) => route.fulfill({ body: pageData, status: 200 }))
    await page.goto(urlWithSlash, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    await page
      .evaluate(() => {
        const el = document.querySelector('.cf-turnstile') as HTMLElement | null
        if (el) el.style.width = '300px'
      })
      .catch(() => undefined)

    for (let attempt = 0; attempt < MAX_CLICK_ATTEMPTS; attempt++) {
      const token = await page.inputValue('[name=cf-turnstile-response]').catch(() => '')
      if (token) {
        log.info(`[turnstile] synthetic solve succeeded on attempt ${attempt + 1}`)
        return token
      }
      await clickWidget(page)
      await sleep(CLICK_INTERVAL_MS)
    }
    return null
  } catch (err) {
    log.warn('[turnstile] synthetic solve failed', err)
    return null
  } finally {
    await page.close().catch(() => undefined)
  }
}

/**
 * Try to solve Turnstile on the live page: click the widget, then fall back to synthetic token injection.
 * Returns true when verificationState would read 'solved' or 'none'.
 */
export async function solveTurnstile(page: Page, context: BrowserContext, isSolved: () => Promise<boolean>): Promise<boolean> {
  // Direct click loop on the host page (works when patchright passes bot checks).
  for (let attempt = 0; attempt < MAX_CLICK_ATTEMPTS; attempt++) {
    if (await isSolved()) return true
    await clickWidget(page)
    await sleep(CLICK_INTERVAL_MS)
    if (await isSolved()) return true
  }

  const params = await extractParams(page)
  if (!params?.sitekey) {
    log.warn('[turnstile] no sitekey found for synthetic fallback')
    return false
  }

  log.info(`[turnstile] trying synthetic solve for sitekey ${params.sitekey.slice(0, 12)}…`)
  const token = await solveSynthetic(context, page.url(), params)
  if (!token) return false

  await injectToken(page, token)
  await sleep(800)
  return isSolved()
}
