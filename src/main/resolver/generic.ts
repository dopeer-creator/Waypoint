import type { Page } from 'patchright'
import type { HostAdapter, VerificationState } from './adapter'

// Browser-side scripts are plain strings so the main-process build needs no DOM typings.

const VERIFICATION_SCRIPT = `(() => {
  const title = (document.title || '').toLowerCase();
  if (title.includes('just a moment') || title.includes('attention required') ||
      document.querySelector('#challenge-running, #challenge-stage, #cf-challenge-running, #challenge-form')) {
    return 'challenge-page';
  }
  const inputs = Array.from(document.querySelectorAll('input[name="cf-turnstile-response"]'));
  if (inputs.length) return inputs.every((i) => i.value && i.value.length > 0) ? 'solved' : 'unsolved';
  if (document.querySelector('.cf-turnstile, [data-sitekey][class*="turnstile"], iframe[src*="challenges.cloudflare.com"]')) {
    return 'unsolved';
  }
  return 'none';
})()`

// Marks the most likely download control with data-waypoint-target. Prefers direct file links, then
// same-site "Download" links/buttons with a real destination, then anything whose own text calls itself
// out as the download action — covers hosts (e.g. fuckingfast.co) where the button is an <a> or <div>
// with no href at all, wired up purely via a JS click listener. An element can be clicked twice before it's
// skipped: hosts like fuckingfast.co open an ad on the first click and only start the download on the second.
// A failed click attempt (see clickLikelyDownload) doesn't count.
const FIND_DOWNLOAD_SCRIPT = `(() => {
  const FILE_RE = /\\.(rar|zip|7z|tar|gz|bz2|xz|iso|img|bin|exe|msi|apk|dmg|mkv|mp4|avi|mov|webm|mp3|flac|pdf|epub|r\\d{2}|\\d{3})$/i;
  // Matched against a control's label (already lowercased and collapsed), so no /i or \\s* needed. Anchored on
  // purpose: a whole marketing sentence that happens to contain "download" is not a download button.
  const GO_RE = /^(continue |proceed |click here )?(to )?(free |slow |direct |regular |standard |normal )?download( (now|file|link|here))?$|^start download$|^(get|create|generate) (your )?(download )?link$/;
  // Costs money or leaves the free flow. Tested against the control's whole text, so a tempting first line
  // can't smuggle in a "$0.16/day" subtitle underneath it.
  const NOPE_RE = /premium|upgrade|subscribe|buy|purchase|pricing|\\$|€|£|torrent|discord|telegram|login|log in|sign in|sign up|register/;
  // The control exists but isn't armed yet — a countdown, or "preparing your download". Wait, don't spend a
  // click on it. Deliberately narrow: anything loose enough to match an ordinary label would break a working host.
  const WAIT_RE = /ready in|preparing|please wait|generating|processing/;
  const site = location.hostname.replace(/^www\\./, '');
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.1;
  };
  const disabled = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled');
  // A control's label is the first line of its visible text: "Free Download / Standard speed" reads as
  // "free download", and the same button mid-countdown reads as "ready in 7s" and is left alone.
  const label = (el) => {
    const raw = el.innerText || el.textContent || el.value || '';
    return raw.trim().split('\\n')[0].replace(/\\s+/g, ' ').trim().toLowerCase();
  };
  // innerText forces a layout pass, so gate on textContent (free) first: only an element whose text even
  // mentions a download pays for the expensive read. This runs against every anchor, several times a second.
  const GATE = /download|link/i;
  const isGo = (el) => {
    const rough = el.textContent || el.value || '';
    if (!GATE.test(rough)) return false;
    if (NOPE_RE.test(rough.toLowerCase())) return false;
    const text = label(el);
    return !WAIT_RE.test(text) && GO_RE.test(text);
  };
  // A real, navigable href: not missing, not "#", not a javascript: pseudo-URL. Anchors with one of these
  // that point off-site are almost always ad decoys mimicking a "Download" button and must never be
  // candidates — clicking them opens ad tabs instead of the real file and wastes the auto-click attempts.
  const navigable = (href) => {
    if (!href) return false;
    const trimmed = href.trim();
    if (!trimmed || trimmed === '#' || /^javascript:/i.test(trimmed)) return false;
    try {
      return /^https?:$/.test(new URL(trimmed, location.href).protocol);
    } catch {
      return false;
    }
  };
  const spent = (el) => Number(el.dataset.waypointClicks || 0) >= 2;
  const candidates = [];
  for (const a of document.querySelectorAll('a')) {
    if (spent(a)) continue;
    const href = a.getAttribute('href');
    if (navigable(href)) {
      const u = new URL(href, location.href);
      let path = u.pathname;
      try { path = decodeURIComponent(path); } catch {}
      if (a.hasAttribute('download') || FILE_RE.test(path)) candidates.push([a, 0]);
      else if (isGo(a) && u.hostname.endsWith(site)) candidates.push([a, 1]);
      // A real href to a different site that doesn't match a file or the current host: leave it alone,
      // it's very likely an ad — do NOT fall through to the JS-click bucket below.
      continue;
    }
    // No real destination at all (missing href, "#", "javascript:...") but its own text names it as the
    // download control — a same-page JS click-handler almost certainly drives it.
    if (isGo(a)) candidates.push([a, 2]);
  }
  for (const b of document.querySelectorAll('button, input[type=submit], input[type=button], [role=button]')) {
    if (spent(b) || disabled(b)) continue;
    if (isGo(b)) candidates.push([b, 2]);
  }
  const pick = candidates.filter(([el]) => visible(el)).sort((x, y) => x[1] - y[1])[0];
  document.querySelectorAll('[data-waypoint-target]').forEach((el) => el.removeAttribute('data-waypoint-target'));
  if (!pick) return '';
  const el = pick[0];
  el.setAttribute('data-waypoint-target', '1');
  // Return a description rather than just "yes": the log then names what was clicked, which is the only way
  // to tell a real download button from an ad decoy wearing the same label on a host we can't see.
  return ('[' + pick[1] + '] ' + (label(el) || el.getAttribute('href') || el.tagName.toLowerCase())).slice(0, 90);
})()`

const MARK_CLICKED_SCRIPT = `(() => {
  const el = document.querySelector('[data-waypoint-target]');
  if (el) el.dataset.waypointClicks = String(Number(el.dataset.waypointClicks || 0) + 1);
})()`

export async function detectVerification(page: Page): Promise<VerificationState> {
  return (await page.evaluate(VERIFICATION_SCRIPT)) as VerificationState
}

/** Returns a description of what it clicked (for the log), or null if there was nothing to click. */
export async function clickLikelyDownload(page: Page): Promise<string | null> {
  const found = (await page.evaluate(FIND_DOWNLOAD_SCRIPT)) as string
  if (!found) return null
  try {
    await page.click('[data-waypoint-target]', { timeout: 3000 })
  } catch {
    // Don't mark it clicked — a transient failure (still animating in, momentarily covered, etc.)
    // shouldn't permanently blacklist what might be the only real download control on the page.
    return null
  }
  await page.evaluate(MARK_CLICKED_SCRIPT).catch(() => undefined)
  return found
}

export const genericAdapter: HostAdapter = {
  id: 'generic',
  match: () => true,
  verificationState: detectVerification,
  triggerDownload: clickLikelyDownload
}
