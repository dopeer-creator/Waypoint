import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { shell } from 'electron'
import type { HandoffBrowser } from '../shared/types'

type InstalledBrowser = Exclude<HandoffBrowser, 'default'>

const EXECUTABLES: Record<InstalledBrowser, string[]> = {
  brave: ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
  chrome: ['Google', 'Chrome', 'Application', 'chrome.exe'],
  edge: ['Microsoft', 'Edge', 'Application', 'msedge.exe']
}

export const BROWSER_NAMES: Record<HandoffBrowser, string> = {
  brave: 'Brave',
  chrome: 'Chrome',
  edge: 'Edge',
  default: 'your browser'
}

export function browserExecutable(browser: InstalledBrowser): string | null {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter((r): r is string => !!r)
  for (const root of roots) {
    const path = join(root, ...EXECUTABLES[browser])
    if (existsSync(path)) return path
  }
  return null
}

export function installedHandoffBrowsers(): HandoffBrowser[] {
  const found: HandoffBrowser[] = (['brave', 'chrome', 'edge'] as const).filter((b) => browserExecutable(b) !== null)
  return [...found, 'default']
}

/**
 * Opens a URL as an ordinary tab in the user's own browser session: no automation flags and no debugging
 * port, so sites see a normal browser. WAYPOINT_BROWSER_ARGS (a JSON array) adds launch arguments, for tests only.
 */
export async function openInBrowser(browser: HandoffBrowser, url: string): Promise<void> {
  const exe = browser === 'default' ? null : browserExecutable(browser)
  if (!exe) {
    await shell.openExternal(url)
    return
  }
  const extra = process.env.WAYPOINT_BROWSER_ARGS ? (JSON.parse(process.env.WAYPOINT_BROWSER_ARGS) as string[]) : []
  spawn(exe, [...extra, url], { detached: true, stdio: 'ignore' }).unref()
}
