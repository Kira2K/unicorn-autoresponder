require('dotenv').config()

const readline = require('node:readline/promises')
const { stdin: input, stdout: output } = require('node:process')

const {
  DEFAULT_INTERVAL_MS,
  DEFAULT_RESTORE_EMAIL,
  DEFAULT_ROTATION_STEPS,
  DEFAULT_TARGET_USER_ID,
  runCredentialRotation,
  runTests
} = require('./logic.ts') as {
  DEFAULT_INTERVAL_MS: number
  DEFAULT_RESTORE_EMAIL: string
  DEFAULT_ROTATION_STEPS: Array<{ email: string; password: string }>
  DEFAULT_TARGET_USER_ID: number
  runCredentialRotation(options: any): Promise<{ email: string; password: string } | null>
  runTests(): Promise<void>
}

const DOLPHIN_API_V2_BASE_URL = 'https://apiv2.dolphin-anty-api.com/api/v2'

type TeamUser = {
  id: number
  username: string
  role: string
}

function getDolphinApiToken(): string {
  const token = String(process.env.dolphin_api_token ?? '').trim()

  if (!token) {
    throw new Error('Missing required environment variable: dolphin_api_token')
  }

  return token
}

function stringifyApiMessage(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value === 'string') {
    return value.trim() || undefined
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

async function requestDolphinApiV2<T>(
  endpointPath: string,
  options: { method?: 'GET' | 'PATCH'; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(`${DOLPHIN_API_V2_BASE_URL}${endpointPath}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${getDolphinApiToken()}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
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
      stringifyApiMessage(data?.message) ||
      stringifyApiMessage(data?.error) ||
      stringifyApiMessage(data) ||
      `Dolphin API v2 failed: ${response.status} ${response.statusText}`
    const error = new Error(message) as Error & { details?: any; status?: number }
    error.details = data
    error.status = response.status
    throw error
  }

  return data as T
}

async function listTeamUsers(): Promise<TeamUser[]> {
  const response = await requestDolphinApiV2<{ data?: TeamUser[] }>('/team/users?limit=100&page=1')

  return response.data ?? []
}

async function updateTeamUserCredentials(
  userId: number,
  patch: { username: string; password: string }
): Promise<unknown> {
  return await requestDolphinApiV2(`/team/users/${userId}`, {
    method: 'PATCH',
    body: patch
  })
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  if (process.argv.includes('--test')) {
    await runTests()
    console.log('dolphin:user-credentials tests passed')
    return
  }

  const rl = readline.createInterface({ input, output })
  let lastApplied: { email: string; password: string } | null = null

  const printLastApplied = (): void => {
    if (lastApplied) {
      console.log(`Last applied email=${lastApplied.email}, pass=${lastApplied.password}`)
    } else {
      console.log('No test email/password was applied yet.')
    }
  }

  process.once('SIGINT', () => {
    console.log('\nInterrupted before normal restore.')
    printLastApplied()
    rl.close()
    process.exit(130)
  })

  try {
    lastApplied = await runCredentialRotation({
      targetUserId: DEFAULT_TARGET_USER_ID,
      restoreEmail: DEFAULT_RESTORE_EMAIL,
      steps: DEFAULT_ROTATION_STEPS,
      intervalMs: DEFAULT_INTERVAL_MS,
      listUsers: listTeamUsers,
      updateUser: updateTeamUserCredentials,
      wait,
      prompt: (question: string) => rl.question(question),
      log: (message: string) => console.log(message),
      onApplied: (credential: { email: string; password: string }) => {
        lastApplied = credential
      }
    })
  } catch (error: any) {
    console.error(error instanceof Error ? error.message : String(error))
    printLastApplied()
    process.exitCode = 1
  } finally {
    rl.close()
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  listTeamUsers,
  requestDolphinApiV2,
  updateTeamUserCredentials
}
