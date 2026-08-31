const assert = require('node:assert/strict')
const { linkedInDolphinLocalError } = require('../dolphin-local-error.ts') as {
  linkedInDolphinLocalError(error: unknown): any
}

async function run(): Promise<void> {
  assert.equal(
    linkedInDolphinLocalError(new Error('fetch failed')).code,
    'dolphin_local_api_unavailable'
  )
  assert.equal(
    linkedInDolphinLocalError(new Error('invalid session token')).code,
    'dolphin_local_session_invalid'
  )
  const unknown = new Error('unexpected start response')
  assert.equal(linkedInDolphinLocalError(unknown), unknown)
}

module.exports = { run }
