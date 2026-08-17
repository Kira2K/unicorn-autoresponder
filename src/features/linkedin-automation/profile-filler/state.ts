const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

type StateFile = {
  schema_version: 1
  sessions: Record<string, { account_id: string; connected_at: string }>
}

function sessionFingerprint(accessToken: string): string {
  return crypto.createHash('sha256').update(accessToken, 'utf8').digest('hex')
}

function emptyState(): StateFile {
  return { schema_version: 1, sessions: {} }
}

function loadState(filePath: string): StateFile {
  if (!fs.existsSync(filePath)) return emptyState()
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<StateFile>
    if (parsed.schema_version !== 1 || !parsed.sessions || typeof parsed.sessions !== 'object') {
      return emptyState()
    }
    return { schema_version: 1, sessions: parsed.sessions }
  } catch {
    return emptyState()
  }
}

function getCachedAccountId(filePath: string, accessToken: string): string | undefined {
  return loadState(filePath).sessions[sessionFingerprint(accessToken)]?.account_id
}

function saveAccountId(filePath: string, accessToken: string, accountId: string): void {
  const state = loadState(filePath)
  state.sessions[sessionFingerprint(accessToken)] = {
    account_id: accountId,
    connected_at: new Date().toISOString()
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporaryPath, filePath)
}

module.exports = {
  getCachedAccountId,
  saveAccountId,
  sessionFingerprint
}
