const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}

const DEFAULT_STALE_LOCK_MS = 15 * 60 * 1000

async function acquireLinkedInProfileLock(
  profileId: number,
  options: {
    lockRoot?: string
    staleAfterMs?: number
    now?: () => number
  } = {}
): Promise<{ release(): Promise<void>; path: string }> {
  const lockRoot = options.lockRoot ?? path.join(os.tmpdir(), 'unicorn-linkedin-auth-locks')
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_LOCK_MS
  const now = options.now ?? (() => Date.now())
  const lockPath = path.join(lockRoot, `dolphin-${profileId}.lock`)

  await fs.mkdir(lockRoot, { recursive: true })

  async function openLock(allowStaleCleanup: boolean): Promise<any> {
    try {
      return await fs.open(lockPath, 'wx')
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error

      if (allowStaleCleanup) {
        const stat = await fs.stat(lockPath).catch(() => undefined)
        if (stat && now() - stat.mtimeMs > staleAfterMs) {
          await fs.unlink(lockPath).catch(() => undefined)
          return await openLock(false)
        }
      }

      throw new LinkedInAuthError(
        'dolphin_profile_in_use',
        `Dolphin profile ${profileId} is already used by another LinkedIn auth process.`
      )
    }
  }

  const handle = await openLock(true)
  await handle.writeFile(JSON.stringify({ profileId, pid: process.pid, createdAt: new Date(now()).toISOString() }))
  let released = false

  return {
    path: lockPath,
    async release() {
      if (released) return
      released = true
      await handle.close().catch(() => undefined)
      await fs.unlink(lockPath).catch(() => undefined)
    }
  }
}

module.exports = {
  DEFAULT_STALE_LOCK_MS,
  acquireLinkedInProfileLock
}
