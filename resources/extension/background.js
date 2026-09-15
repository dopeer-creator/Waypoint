// Waypoint browser extension.
// Every download that starts in this browser is offered to the Waypoint app on this PC. Waypoint only takes one
// while it is resolving a link from the same site; then this cancels the browser's copy and Waypoint downloads
// the file itself. Everything else is left to the browser. Nothing here touches page content.

const PORTS = [47815, 47816]
const VERSION = chrome.runtime.getManifest().version

async function post(port, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Waypoint-Extension': VERSION },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(3000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Lets Waypoint know the extension is installed, and reports which Waypoint apps are running. */
async function checkIn() {
  const apps = []
  for (const port of PORTS) {
    try {
      const status = await post(port, '/v1/status')
      if (status.app === 'waypoint') apps.push({ port, version: status.version })
    } catch {
      // Not running on this port.
    }
  }
  await chrome.storage.session.set({ apps, checkedAt: Date.now() })
  return apps
}

function scheduleCheckIns() {
  chrome.alarms.create('check-in', { periodInMinutes: 0.5 })
  checkIn()
}

chrome.runtime.onInstalled.addListener(scheduleCheckIns)
chrome.runtime.onStartup.addListener(scheduleCheckIns)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'check-in') checkIn()
})
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message !== 'check-in') return false
  checkIn().then(reply)
  return true
})

const withoutHash = (url) => (url || '').split('#')[0]

/** The tab whose page started the download, matched by referrer. */
async function sourceTab(item) {
  const referrer = withoutHash(item.referrer)
  if (!referrer) return null
  const tabs = await chrome.tabs.query({})
  return tabs.find((tab) => withoutHash(tab.url) === referrer) ?? null
}

async function offer(item) {
  const url = item.finalUrl || item.url
  if (!/^https?:/i.test(url)) return false

  const [cookies, tab] = await Promise.all([chrome.cookies.getAll({ url }).catch(() => []), sourceTab(item)])
  const download = {
    url,
    filename: (item.filename || '').split(/[\\/]/).pop(),
    referrer: item.referrer || '',
    tabUrl: tab?.url || '',
    cookies: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    userAgent: navigator.userAgent
  }

  for (const port of PORTS) {
    let decision
    try {
      decision = await post(port, '/v1/capture', download)
    } catch {
      continue
    }
    if (!decision.take) continue
    await chrome.downloads.cancel(item.id).catch(() => {})
    await chrome.downloads.erase({ id: item.id }).catch(() => {})
    if (decision.closeTab && tab) chrome.tabs.remove(tab.id).catch(() => {})
    return true
  }
  return false
}

// Fires once the browser knows the file name, before anything is saved.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  offer(item).then(
    (taken) => {
      if (!taken) suggest()
    },
    () => suggest()
  )
  return true
})
