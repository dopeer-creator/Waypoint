import type { Page } from 'playwright-core'
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
// same-site "Download" links, then "Download" buttons. Each element is tried once.
const FIND_DOWNLOAD_SCRIPT = `(() => {
  const FILE_RE = /\\.(rar|zip|7z|tar|gz|bz2|xz|iso|img|bin|exe|msi|apk|dmg|mkv|mp4|avi|mov|webm|mp3|flac|pdf|epub|r\\d{2}|\\d{3})$/i;
  const TEXT_RE = /^\\s*((free|slow|direct|regular)\\s+)?download(\\s+(now|file|link))?\\s*$|^\\s*(get|create|generate)\\s+(download\\s+)?link\\s*$/i;
  const site = location.hostname.replace(/^www\\./, '');
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.1;
  };
  const candidates = [];
  for (const a of document.querySelectorAll('a[href]')) {
    if (a.dataset.waypointClicked) continue;
    let u;
    try { u = new URL(a.href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    let path = u.pathname;
    try { path = decodeURIComponent(path); } catch {}
    if (a.hasAttribute('download') || FILE_RE.test(path)) candidates.push([a, 0]);
    else if (TEXT_RE.test(a.textContent || '') && u.hostname.endsWith(site)) candidates.push([a, 1]);
  }
  for (const b of document.querySelectorAll('button, input[type=submit], input[type=button]')) {
    if (b.dataset.waypointClicked || b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
    if (TEXT_RE.test(b.textContent || b.value || '')) candidates.push([b, 2]);
  }
  const pick = candidates.filter(([el]) => visible(el)).sort((x, y) => x[1] - y[1])[0];
  document.querySelectorAll('[data-waypoint-target]').forEach((el) => el.removeAttribute('data-waypoint-target'));
  if (!pick) return false;
  pick[0].setAttribute('data-waypoint-target', '1');
  pick[0].dataset.waypointClicked = '1';
  return true;
})()`

export async function detectVerification(page: Page): Promise<VerificationState> {
  return (await page.evaluate(VERIFICATION_SCRIPT)) as VerificationState
}

export async function clickLikelyDownload(page: Page): Promise<boolean> {
  const found = (await page.evaluate(FIND_DOWNLOAD_SCRIPT)) as boolean
  if (!found) return false
  await page.click('[data-waypoint-target]', { timeout: 3000 })
  return true
}

export const genericAdapter: HostAdapter = {
  id: 'generic',
  match: () => true,
  verificationState: detectVerification,
  triggerDownload: clickLikelyDownload
}
