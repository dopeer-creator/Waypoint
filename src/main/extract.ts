import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import log from 'electron-log/main'

function regQuery(key: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const match = stdout.match(/REG_SZ\s+(.+?)\s*$/m)
      resolve(match ? match[1] : null)
    })
  })
}

/** Finds WinRAR.exe: explicit setting, then registry, then default install folders. */
export async function findWinRAR(override: string): Promise<string | null> {
  if (override && existsSync(override)) return override

  const registry: [string, string][] = [
    ['HKLM\\SOFTWARE\\WinRAR', 'exe64'],
    ['HKLM\\SOFTWARE\\WinRAR', 'exe32'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\WinRAR', 'exe32'],
    ['HKCU\\SOFTWARE\\WinRAR', 'exe64']
  ]
  for (const [key, value] of registry) {
    const path = await regQuery(key, value)
    if (path && existsSync(path)) return path
  }

  const folders = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files']
  for (const folder of folders) {
    if (!folder) continue
    const path = join(folder, 'WinRAR', 'WinRAR.exe')
    if (existsSync(path)) return path
  }
  return null
}

export interface ArchiveSet {
  /** The volume WinRAR should be pointed at. */
  first: string
  members: string[]
}

/**
 * Groups archive files into sets so each multi-volume archive is extracted once, from its first volume.
 * Handles name.partN.rar, name.rar + name.r00, name.zip/.7z, name.zip.001/.7z.001, and name.zip + name.z01.
 */
export function groupArchives(files: string[]): ArchiveSet[] {
  const sets = new Map<string, ArchiveSet>()
  const add = (key: string, file: string, isFirst: boolean) => {
    let set = sets.get(key)
    if (!set) {
      set = { first: '', members: [] }
      sets.set(key, set)
    }
    set.members.push(file)
    if (isFirst) set.first = file
  }

  for (const file of files) {
    const name = basename(file)
    const base = (stem: string) => join(dirname(file), stem).toLowerCase()
    let m: RegExpMatchArray | null
    if ((m = name.match(/^(.*)\.part(\d+)\.rar$/i))) add(`${base(m[1])}|rar`, file, Number(m[2]) === 1)
    else if ((m = name.match(/^(.*)\.rar$/i))) add(`${base(m[1])}|rar`, file, true)
    else if ((m = name.match(/^(.*)\.r\d{2,3}$/i))) add(`${base(m[1])}|rar`, file, false)
    else if ((m = name.match(/^(.*)\.(zip|7z)\.(\d{3})$/i))) add(`${base(m[1])}|${m[2].toLowerCase()}`, file, Number(m[3]) === 1)
    else if ((m = name.match(/^(.*)\.(zip|7z)$/i))) add(`${base(m[1])}|${m[2].toLowerCase()}`, file, true)
    else if ((m = name.match(/^(.*)\.z\d{2}$/i))) add(`${base(m[1])}|zip`, file, false)
  }

  return [...sets.values()].filter((set) => set.first)
}

const WINRAR_EXIT: Record<number, string> = {
  2: 'fatal error',
  3: 'CRC error — archive is corrupt or a volume is missing',
  4: 'archive is locked',
  5: 'write error — disk full or no permission',
  6: 'could not open a file',
  7: 'bad command line',
  8: 'not enough memory',
  9: 'could not create a file',
  10: 'no files to extract',
  11: 'archive is password protected',
  12: 'read error',
  255: 'extraction cancelled'
}

/** Extracts one archive into dest, overwriting. `-p-` stops password prompts, `-inul` suppresses error dialogs. */
export function extractArchive(winrar: string, archive: string, dest: string): Promise<void> {
  const target = dest.endsWith('\\') ? dest : `${dest}\\`
  return new Promise((resolve, reject) => {
    log.info(`[extract] ${archive} -> ${target}`)
    const proc = spawn(winrar, ['x', '-o+', '-p-', '-y', '-ibck', '-inul', archive, target], { windowsHide: true })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      // 1 is a non-fatal warning.
      if (code === 0 || code === 1) resolve()
      else reject(new Error(`${basename(archive)}: ${WINRAR_EXIT[code ?? -1] ?? `WinRAR exit code ${code}`}`))
    })
  })
}
