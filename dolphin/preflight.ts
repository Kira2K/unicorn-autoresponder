const childProcess = require('node:child_process')

const {
  DOLPHIN_LOCAL_API_BASE_URL,
  DOLPHIN_LOCAL_API_HEALTH_TIMEOUT_MS,
  MAX_PREEXISTING_DOLPHIN_PROFILES
} = require('../orchestrator/config.ts')
const { getErrorMessage } = require('../orchestrator/runtime-utils.ts')

function getRunningDolphinBrowserProfileIds(): number[] {
  const command = [
    '$ErrorActionPreference = "Stop";',
    'Get-CimInstance Win32_Process',
    "| Where-Object { $_.Name -eq 'anty.exe' -and $_.CommandLine -match 'browser_profiles\\\\\\d+\\\\data_dir' }",
    "| ForEach-Object { if ($_.CommandLine -match 'browser_profiles\\\\(\\d+)\\\\data_dir') { $Matches[1] } }",
    '| Sort-Object -Unique',
    '| ConvertTo-Json'
  ].join(' ')
  const stdout = childProcess
    .execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      {
        encoding: 'utf8'
      }
    )
    .trim()

  if (!stdout) {
    return []
  }

  const parsed = JSON.parse(stdout)
  const ids = Array.isArray(parsed) ? parsed : [parsed]

  return ids.map(id => Number(id)).filter(id => Number.isFinite(id))
}

async function assertPreexistingDolphinProfileLimit(): Promise<void> {
  const runningProfileIds = getRunningDolphinBrowserProfileIds()

  if (runningProfileIds.length > MAX_PREEXISTING_DOLPHIN_PROFILES) {
    throw new Error(
      `Too many Dolphin profiles are already open before automation start: ` +
        `${runningProfileIds.length}/${MAX_PREEXISTING_DOLPHIN_PROFILES}. ` +
        `Open profile ids: ${runningProfileIds.join(', ')}`
    )
  }

  console.log(
    `Preflight Dolphin profiles: ${runningProfileIds.length}/${MAX_PREEXISTING_DOLPHIN_PROFILES}` +
      (runningProfileIds.length ? ` (${runningProfileIds.join(', ')})` : '')
  )
}

async function assertDolphinAppRunning(): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    DOLPHIN_LOCAL_API_HEALTH_TIMEOUT_MS
  )

  try {
    await fetch(`${DOLPHIN_LOCAL_API_BASE_URL}/browser_profiles`, {
      method: 'GET',
      signal: controller.signal
    })
  } catch (error: unknown) {
    throw new Error(
      `Dolphin Anty app is not reachable at ${DOLPHIN_LOCAL_API_BASE_URL}. ` +
        `Open Dolphin Anty and wait until the local API on port 3001 is ready, then rerun. ` +
        `Original error: ${getErrorMessage(error)}`
    )
  } finally {
    clearTimeout(timeout)
  }

  console.log(
    `Preflight Dolphin app: local API is reachable at ${DOLPHIN_LOCAL_API_BASE_URL}`
  )
}

module.exports = {
  assertDolphinAppRunning,
  assertPreexistingDolphinProfileLimit,
  getRunningDolphinBrowserProfileIds
}
