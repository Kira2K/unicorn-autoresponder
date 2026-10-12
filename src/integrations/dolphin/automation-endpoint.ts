const fs = require('node:fs/promises') as typeof import('node:fs/promises')
const path = require('node:path') as typeof import('node:path')
/** Recover only a newly started owned Windows profile, never an existing arbitrary browser. */
async function readStartedDolphinEndpoint(profileId: number, startedAt: number) {
  if (!process.env.APPDATA || !Number.isSafeInteger(profileId) || profileId <= 0) throw Error('dolphin_endpoint_recovery_unavailable')
  const portPath = path.join(process.env.APPDATA, 'dolphin_anty', 'browser_profiles', String(profileId), 'data_dir', 'DevToolsActivePort')
  for (let i = 0; i < 10; i++) {
    try {
      const stat = await fs.stat(portPath)
      if (stat.mtimeMs < startedAt - 1000) throw Error('stale_dolphin_endpoint')
      const [rawPort, endpoint] = (await fs.readFile(portPath, 'utf8')).trim().split(/\r?\n/), port = Number(rawPort)
      if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\/devtools\/browser\/[a-z0-9-]+$/i.test(endpoint ?? '')) throw Error('invalid_dolphin_endpoint')
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000), redirect: 'error' })
      const version = await response.json() as { webSocketDebuggerUrl?: string }
      if (!response.ok || new URL(version.webSocketDebuggerUrl ?? '').pathname !== endpoint) throw Error('dolphin_endpoint_mismatch')
      return { success: true, automation: { port, wsEndpoint: endpoint } }
    } catch { if (i === 9) throw Error('dolphin_owned_start_needs_reconciliation'); await new Promise(resolve => setTimeout(resolve, 250)) }
  }
  throw Error('dolphin_owned_start_needs_reconciliation')
}
module.exports = { readStartedDolphinEndpoint }
