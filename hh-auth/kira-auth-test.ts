const fs = require('node:fs/promises')
const path = require('node:path')
require('dotenv').config({ quiet: true })

const { makeHHAuth } = require('./make-hh-auth.ts')
const { getClientHHAuthCredentials } = require('../google-sheets-check.ts')

type BrowserMode = 'headless' | 'headfull'

type DolphinStartResponse = {
  success?: boolean
  automation?: {
    port?: number
    wsEndpoint?: string
  }
  error?: string
  errorObject?: {
    code?: string
    text?: string
  }
}

const KIRA_PROFILE_ID = 770032142
const DOLPHIN_LOCAL_API_BASE_URL = 'http://localhost:3001/v1.0'
const AUTH_TIMEOUT_MS = 30000
const artifactDir = path.resolve(
  __dirname,
  '..',
  'logs',
  `hh-auth-kira-${new Date().toISOString().replace(/[:.]/g, '-')}`
)
const finalLogFile = path.join(artifactDir, 'auth-run.log')
const events: Array<Record<string, unknown>> = []

function now(): string {
  return new Date().toISOString()
}

function log(message: string, details: Record<string, unknown> = {}): void {
  const event = {
    at: now(),
    message,
    ...details
  }
  events.push(event)
  console.log(JSON.stringify(event))
}

function stringifyApiMessage(value: unknown): string {
  if (!value) {
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

async function writeFinalLog(extra: Record<string, unknown> = {}): Promise<void> {
  await fs.mkdir(artifactDir, { recursive: true })
  const files = await fs.readdir(artifactDir).catch(() => [])
  const payload = {
    at: now(),
    artifactDir,
    profileId: KIRA_PROFILE_ID,
    files,
    ...extra,
    events
  }

  await fs.writeFile(finalLogFile, JSON.stringify(payload, null, 2), 'utf8')
}

async function requestLocalDolphin<T>(
  endpointPath: string,
  options: {
    method?: 'GET' | 'POST'
    body?: unknown
  } = {}
): Promise<T> {
  const response = await fetch(`${DOLPHIN_LOCAL_API_BASE_URL}${endpointPath}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  const responseText = await response.text()
  let data: any = null

  try {
    data = responseText ? JSON.parse(responseText) : null
  } catch {
    data = responseText
  }

  if (!response.ok) {
    const message =
      stringifyApiMessage(data?.error) ||
      stringifyApiMessage(data?.message) ||
      stringifyApiMessage(data) ||
      `Dolphin local API failed: ${response.status} ${response.statusText}`

    const error = new Error(message) as Error & { details?: unknown }
    error.details = data
    throw error
  }

  return data as T
}

function isAlreadyRunningResponse(response: DolphinStartResponse): boolean {
  const message = String(response.error ?? response.errorObject?.text ?? '').toLowerCase()

  return response.errorObject?.code === 'E_BROWSER_RUN_DUPLICATE' || message.includes('already running')
}

function isAlreadyRunningError(error: any): boolean {
  const code = error?.details?.errorObject?.code
  const message = String(error?.message ?? error?.details?.error ?? error?.details?.message ?? '').toLowerCase()

  return code === 'E_BROWSER_RUN_DUPLICATE' || message.includes('already running')
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function stopProfile(profileId: number): Promise<void> {
  log('Stopping Dolphin profile', { profileId })
  await requestLocalDolphin(`/browser_profiles/${profileId}/stop`).catch((error: unknown) => {
    log('Dolphin profile stop failed', {
      profileId,
      error: error instanceof Error ? error.message : String(error)
    })
  })
  await wait(4000)
}

async function startProfile(profileId: number, mode: BrowserMode): Promise<{ profileId: number, mode: BrowserMode, port: number }> {
  const body = {
    automation: true,
    headless: mode === 'headless'
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    log('Starting Dolphin profile', { profileId, mode, attempt })
    let response: DolphinStartResponse

    try {
      response = await requestLocalDolphin<DolphinStartResponse>(
        `/browser_profiles/${profileId}/start`,
        {
          method: 'POST',
          body
        }
      )
    } catch (error: unknown) {
      if (!isAlreadyRunningError(error)) {
        throw error
      }

      log('Dolphin reported duplicate running profile as error, stopping before retry', { profileId, mode, attempt })
      await stopProfile(profileId)
      await wait(2000 * attempt)
      continue
    }

    if (response.success === false || isAlreadyRunningResponse(response)) {
      log('Dolphin reported duplicate running profile, stopping before retry', { profileId, mode, attempt })
      await stopProfile(profileId)
      await wait(2000 * attempt)
      continue
    }

    const port = response.automation?.port

    if (!port) {
      throw new Error(`Dolphin did not return automation port for ${profileId}`)
    }

    return {
      profileId,
      mode,
      port
    }
  }

  throw new Error(`Dolphin profile ${profileId} did not start in ${mode} mode`)
}

function loadPlaywright(): any {
  try {
    return require('playwright')
  } catch {
    return require('C:/Users/kiras/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
  }
}

async function connectToProfile(startedProfile: { port: number }): Promise<any> {
  const { chromium } = loadPlaywright()
  return await chromium.connectOverCDP(`http://127.0.0.1:${startedProfile.port}`, {
    timeout: AUTH_TIMEOUT_MS
  })
}

async function main(): Promise<void> {
  await fs.mkdir(artifactDir, { recursive: true })
  log('Kira HH auth test started', {
    artifactDir,
    profileId: KIRA_PROFILE_ID
  })

  const hhAuth = makeHHAuth({
    artifactDir,
    getCredentials: async () => {
      const credentials = await getClientHHAuthCredentials('Кира')

      log('Loaded Kira HH auth credentials from sheet', {
        clientName: credentials.clientName,
        rawPhone: credentials.rawPhone,
        phone: credentials.phone,
        hasPassword: Boolean(credentials.password),
        hasEmail: Boolean(credentials.email),
        hasEmailPassword: Boolean(credentials.emailPassword)
      })

      return {
        phone: credentials.phone,
        password: credentials.password
      }
    },
    connectToProfile,
    log,
    startProfile,
    stopProfile,
    timeoutMs: AUTH_TIMEOUT_MS
  })

  const result = await hhAuth.ensureAuthorized(KIRA_PROFILE_ID)
  log('Kira HH auth test completed', {
    result
  })
  await writeFinalLog({
    ok: true,
    result
  })
}

main().catch(async (error: unknown) => {
  const details = error instanceof Error
    ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: (error as any).code,
      details: (error as any).details
    }
    : {
      message: String(error)
    }

  log('Kira HH auth test failed', details)
  await stopProfile(KIRA_PROFILE_ID)
  await writeFinalLog({
    ok: false,
    error: details
  })
  process.exitCode = 1
})
