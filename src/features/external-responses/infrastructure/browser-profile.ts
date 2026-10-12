import { cp, mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { atomicJson } from './store.ts'

async function profileInUse(profilePath: string): Promise<boolean> {
  const exec = promisify(execFile)
  const { stdout } = process.platform === 'win32'
    ? await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe' OR Name = 'chromium.exe' OR Name = 'msedge.exe'\" | Select-Object -ExpandProperty CommandLine) | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 20_000 })
    : await exec('ps', ['-eo', 'args'], { timeout: 20_000 })
  const commands: string[] = process.platform === 'win32' ? [].concat(JSON.parse(stdout.trim() || '[]')) : stdout.split('\n')
  const normalized = profilePath.replace(/\\/g, '/').toLowerCase()
  return commands.some(command => command && command.includes('--user-data-dir') && command.replace(/\\/g, '/').toLowerCase().includes(normalized))
}

/** Lease an idle feature-owned profile and preserve its pre-Patchright contents once. */
export async function prepareBrowserProfile(input: { profilePath: string; driver: 'playwright' | 'patchright' }, deps = { isInUse: profileInUse }) {
  const profilePath = resolve(input.profilePath), lockPath = `${profilePath}.session.lock`, sessionId = randomUUID()
  await mkdir(dirname(profilePath), { recursive: true })
  let lock
  try { lock = await open(lockPath, 'wx', 0o600) }
  catch (error: any) { if (error.code === 'EEXIST') throw Error(`Browser profile is leased: ${lockPath}. Check the recorded PID before removing a stale lease.`); throw error }
  let releasePromise: Promise<void> | undefined
  const release = () => releasePromise ??= (async () => {
    const owner = JSON.parse(await readFile(lockPath, 'utf8').catch(() => '{}'))
    if (owner.sessionId === sessionId) await unlink(lockPath)
  })()
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, sessionId, at: new Date().toISOString() })); await lock.sync(); await lock.close()
    if (await deps.isInUse(profilePath)) throw Error('Browser profile is in use; finish or close its existing session before starting another.')
    let backupPath: string | undefined
    if (input.driver === 'patchright') {
      const markerPath = `${profilePath}.patchright-backup.json`
      const marker = await readFile(markerPath, 'utf8').catch((e: any) => { if (e.code === 'ENOENT') return undefined; throw e })
      if (marker) {
        backupPath = JSON.parse(marker).backupPath
        if (!backupPath || !(await stat(backupPath)).isDirectory()) throw Error('Recorded pre-Patchright profile backup is unavailable')
      } else {
        const entries = await readdir(profilePath).catch((e: any) => { if (e.code === 'ENOENT') return []; throw e })
        if (entries.length) {
          backupPath = join(dirname(profilePath), 'browser-backups', `${basename(profilePath)}-before-patchright-${sessionId}`)
          await cp(profilePath, backupPath, { recursive: true, errorOnExist: true, force: false })
          await atomicJson(markerPath, { backupPath, at: new Date().toISOString() })
        }
      }
    }
    return { release, backupPath }
  } catch (error) { await lock.close().catch(() => {}); await release(); throw error }
}
