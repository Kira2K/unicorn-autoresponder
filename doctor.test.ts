const assert = require('node:assert/strict')

const {
  DEFAULT_AUTH_PREFLIGHT_CLIENT,
  parseArgs,
  runAuthPreflight
} = require('./doctor.ts') as {
  DEFAULT_AUTH_PREFLIGHT_CLIENT: string
  parseArgs(args: string[]): {
    authPreflight: boolean
    client?: string
    env: boolean
    help: boolean
    stopBeforeHh: boolean
  }
  runAuthPreflight(
    options: {
      authPreflight: boolean
      client?: string
      env: boolean
      help: boolean
      stopBeforeHh: boolean
    },
    dependencies: {
      assertDolphinAppRunning(): Promise<void>
      createAppDb(): any
      log(message: string): void
    }
  ): Promise<void>
}

function makeTarget(patch: Record<string, unknown> = {}) {
  return {
    clientName: DEFAULT_AUTH_PREFLIGHT_CLIENT,
    market: 'Ru',
    stack: 'FRONTEND',
    stackSheetName: 'FRONTEND',
    stackScenario: 'https://hh.ru/search/vacancy?text=frontend',
    dolphinProfileId: 770032142,
    commonChatId: '5216637594',
    ...patch
  }
}

function makeCredentials(patch: Record<string, unknown> = {}) {
  return {
    clientName: DEFAULT_AUTH_PREFLIGHT_CLIENT,
    commonChatId: '5216637594',
    market: 'Ru',
    phone: '+10000000000',
    rawPhone: '+10000000000',
    email: 'kira@example.test',
    password: 'secret',
    ...patch
  }
}

async function testParseAuthPreflightArgs(): Promise<void> {
  const options = parseArgs([
    '--auth-preflight',
    '--client',
    DEFAULT_AUTH_PREFLIGHT_CLIENT,
    '--stop-before-hh'
  ])

  assert.equal(options.authPreflight, true)
  assert.equal(options.client, DEFAULT_AUTH_PREFLIGHT_CLIENT)
  assert.equal(options.stopBeforeHh, true)
}

async function testRunAuthPreflightStopsBeforeHh(): Promise<void> {
  const previousToken = process.env.dolphin_api_token
  process.env.dolphin_api_token = 'token-for-test'
  let dolphinHealthChecked = false
  let credentialsRequested = false
  const logs: string[] = []

  try {
    await runAuthPreflight(
      {
        authPreflight: true,
        client: DEFAULT_AUTH_PREFLIGHT_CLIENT,
        env: false,
        help: false,
        stopBeforeHh: true
      },
      {
        async assertDolphinAppRunning() {
          dolphinHealthChecked = true
        },
        createAppDb() {
          return {
            async getAutomationTargets() {
              return [makeTarget()]
            },
            async getHHAuthCredentialsByCommonChatId(
              commonChatId: string,
              market: 'Ru' | 'En'
            ) {
              credentialsRequested = true
              assert.equal(commonChatId, '5216637594')
              assert.equal(market, 'Ru')
              return makeCredentials()
            }
          }
        },
        log(message: string) {
          logs.push(message)
        }
      }
    )
  } finally {
    if (previousToken === undefined) {
      delete process.env.dolphin_api_token
    } else {
      process.env.dolphin_api_token = previousToken
    }
  }

  assert.equal(credentialsRequested, true)
  assert.equal(dolphinHealthChecked, true)
  assert.equal(
    logs.some(message => message.includes('HH live checks: skipped by --stop-before-hh')),
    true
  )
}

async function testRunAuthPreflightRequiresStopBeforeHh(): Promise<void> {
  await assert.rejects(
    () =>
      runAuthPreflight(
        {
          authPreflight: true,
          env: false,
          help: false,
          stopBeforeHh: false
        },
        {
          async assertDolphinAppRunning() {
            throw new Error('should not touch Dolphin')
          },
          createAppDb() {
            throw new Error('should not touch db')
          },
          log() {}
        }
      ),
    /requires --stop-before-hh/
  )
}

async function testRunAuthPreflightRequiresToken(): Promise<void> {
  const previousToken = process.env.dolphin_api_token
  delete process.env.dolphin_api_token

  try {
    await assert.rejects(
      () =>
        runAuthPreflight(
          {
            authPreflight: true,
            client: DEFAULT_AUTH_PREFLIGHT_CLIENT,
            env: false,
            help: false,
            stopBeforeHh: true
          },
          {
            async assertDolphinAppRunning() {
              throw new Error('should not touch Dolphin without token')
            },
            createAppDb() {
              return {
                async getAutomationTargets() {
                  return [makeTarget()]
                },
                async getHHAuthCredentialsByCommonChatId() {
                  return makeCredentials()
                }
              }
            },
            log() {}
          }
        ),
      /dolphin_api_token/
    )
  } finally {
    if (previousToken !== undefined) {
      process.env.dolphin_api_token = previousToken
    }
  }
}

async function main(): Promise<void> {
  await testParseAuthPreflightArgs()
  await testRunAuthPreflightStopsBeforeHh()
  await testRunAuthPreflightRequiresStopBeforeHh()
  await testRunAuthPreflightRequiresToken()

  console.log('doctor tests passed')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
