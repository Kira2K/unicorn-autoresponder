const childProcess = require('node:child_process')

const {
  DOLPHIN_LOCAL_API_BASE_URL,
  DOLPHIN_LOCAL_API_HEALTH_TIMEOUT_MS,
  DOLPHIN_PREFLIGHT_AUTO_CLEANUP,
  MAX_PREEXISTING_DOLPHIN_PROFILES
} = require('../orchestrator/config.ts')
const { getErrorMessage } = require('../orchestrator/runtime-utils.ts')
const { loginLocalDolphinWithToken, requestLocalDolphin } = require('./local-api.ts') as {
  loginLocalDolphinWithToken(): Promise<unknown>
  requestLocalDolphin<T>(endpointPath: string): Promise<T>
}

function stringifyPreflightBody(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function getDolphinSessionRepairMessage(): string {
  return (
    `Dolphin Anty local API session is invalid or stuck refreshing its token. ` +
    `Open Dolphin Anty, re-login if needed, wait until browser profiles are visible, ` +
    `then rerun the orchestrator.`
  )
}

function isDolphinSessionError(status: number, responseText: string): boolean {
  const text = responseText.toLowerCase()

  return (
    status === 401 ||
    text.includes('invalid session token') ||
    text.includes('token refresh timeout') ||
    text.includes('refresh token') ||
    text.includes('unauthorized')
  )
}

function assertDolphinLocalApiResponseHealthy(
  response: {
    ok: boolean
    status: number
    statusText?: string
  },
  responseBody: unknown,
  baseUrl = DOLPHIN_LOCAL_API_BASE_URL
): void {
  if (response.ok) {
    return
  }

  const responseText = stringifyPreflightBody(responseBody)

  if (isDolphinSessionError(response.status, responseText)) {
    const error = new Error(
      `${getDolphinSessionRepairMessage()} ` +
        `Local API ${baseUrl}/browser_profiles returned ` +
        `${response.status} ${response.statusText || ''}`.trim() +
        (responseText ? `: ${responseText}` : '')
    ) as Error & { isDolphinLocalApiHealthError?: boolean }
    error.isDolphinLocalApiHealthError = true

    throw error
  }

  const error = new Error(
    `Dolphin Anty local API is reachable at ${baseUrl}, but the health check failed: ` +
      `${response.status} ${response.statusText || ''}`.trim() +
      (responseText ? `: ${responseText}` : '')
  ) as Error & { isDolphinLocalApiHealthError?: boolean }
  error.isDolphinLocalApiHealthError = true

  throw error
}

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

function parseJsonArrayOutput(stdout: string): any[] {
  const text = stdout.trim()
  if (!text) {
    return []
  }

  const parsed = JSON.parse(text)
  if (!parsed) {
    return []
  }

  return Array.isArray(parsed) ? parsed : [parsed]
}

function killDolphinBrowserProfileProcesses(profileIds: number[]): Array<{
  processId: number
  parentProcessId: number
  profileId: number
}> {
  const ids = [...new Set(profileIds)]
    .map(id => Number(id))
    .filter(id => Number.isFinite(id) && id > 0)

  if (!ids.length) {
    return []
  }

  const profilePattern = `browser_profiles\\\\(${ids.join('|')})\\\\data_dir`
  const command = [
    '$ErrorActionPreference = "Stop";',
    `$profilePattern = '${profilePattern}';`,
    '$targets = @(Get-CimInstance Win32_Process',
    "| Where-Object { $_.Name -eq 'anty.exe' -and $_.CommandLine -match $profilePattern }",
    "| ForEach-Object { if ($_.CommandLine -match 'browser_profiles\\\\(\\d+)\\\\data_dir') {",
    '[pscustomobject]@{ ProcessId = $_.ProcessId; ParentProcessId = $_.ParentProcessId; ProfileId = [int]$Matches[1] }',
    '} });',
    '$targets | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };',
    "if ($targets.Count -eq 0) { '[]' } else { $targets | ConvertTo-Json -Compress }"
  ].join(' ')

  const stdout = childProcess.execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8'
    }
  )

  return parseJsonArrayOutput(stdout)
    .map(item => ({
      processId: Number(item.ProcessId),
      parentProcessId: Number(item.ParentProcessId),
      profileId: Number(item.ProfileId)
    }))
    .filter(
      item =>
        Number.isFinite(item.processId) &&
        Number.isFinite(item.parentProcessId) &&
        Number.isFinite(item.profileId)
    )
}

async function cleanupPreexistingDolphinProfiles(profileIds: number[]): Promise<void> {
  const uniqueProfileIds = [...new Set(profileIds)]

  if (!uniqueProfileIds.length) {
    return
  }

  console.warn(
    `Preflight Dolphin cleanup: stopping ${uniqueProfileIds.length} blocking profile(s): ` +
      uniqueProfileIds.join(', ')
  )

  await Promise.all(
    uniqueProfileIds.map(async profileId => {
      try {
        await requestLocalDolphin(`/browser_profiles/${profileId}/stop`)
      } catch (error: unknown) {
        console.warn(
          `Preflight Dolphin cleanup: local stop for profile ${profileId} failed: ${getErrorMessage(error)}`
        )
      }
    })
  )

  const killedProcesses = killDolphinBrowserProfileProcesses(uniqueProfileIds)
  if (killedProcesses.length) {
    const killedProfileIds = [...new Set(killedProcesses.map(item => item.profileId))]
    console.warn(
      `Preflight Dolphin cleanup: terminated ${killedProcesses.length} leftover anty.exe process(es) ` +
        `for profile(s): ${killedProfileIds.join(', ')}`
    )
  }
}

async function assertPreexistingDolphinProfileLimit(): Promise<void> {
  let runningProfileIds = getRunningDolphinBrowserProfileIds()

  if (
    DOLPHIN_PREFLIGHT_AUTO_CLEANUP &&
    runningProfileIds.length > MAX_PREEXISTING_DOLPHIN_PROFILES
  ) {
    await cleanupPreexistingDolphinProfiles(runningProfileIds)
    runningProfileIds = getRunningDolphinBrowserProfileIds()
  }

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
  try {
    await Promise.race([
      loginLocalDolphinWithToken(),
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error(`Local API token login timed out after ${DOLPHIN_LOCAL_API_HEALTH_TIMEOUT_MS}ms`)),
          DOLPHIN_LOCAL_API_HEALTH_TIMEOUT_MS
        )
      })
    ])
  } catch (error: unknown) {
    if ((error as any)?.isDolphinLocalApiHealthError) {
      throw error
    }

    throw new Error(
      `Dolphin Anty app is not reachable at ${DOLPHIN_LOCAL_API_BASE_URL}. ` +
        `Open Dolphin Anty and wait until the local API on port 3001 is ready, then rerun. ` +
      `Original error: ${getErrorMessage(error)}`
    )
  }

  console.log(
    `Preflight Dolphin app: local API is reachable at ${DOLPHIN_LOCAL_API_BASE_URL}; ` +
      `token stored with /auth/login-with-token`
  )
}

module.exports = {
  assertDolphinLocalApiResponseHealthy,
  assertDolphinAppRunning,
  assertPreexistingDolphinProfileLimit,
  cleanupPreexistingDolphinProfiles,
  getRunningDolphinBrowserProfileIds,
  killDolphinBrowserProfileProcesses,
  isDolphinSessionError
}
