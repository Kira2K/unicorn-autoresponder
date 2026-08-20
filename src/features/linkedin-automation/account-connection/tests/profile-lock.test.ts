const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { acquireLinkedInProfileLock } = require('../profile-lock.ts') as {
  acquireLinkedInProfileLock(id: number, options: any): Promise<{ release(): Promise<void> }>
}

async function run(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linkedin-lock-test-'))
  try {
    const first = await acquireLinkedInProfileLock(17, { lockRoot: root })
    await assert.rejects(
      acquireLinkedInProfileLock(17, { lockRoot: root }),
      (error: any) => error.code === 'dolphin_profile_in_use'
    )
    await first.release()
    const second = await acquireLinkedInProfileLock(17, { lockRoot: root })
    await second.release()
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

module.exports = { run }
