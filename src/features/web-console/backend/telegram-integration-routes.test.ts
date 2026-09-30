const assert = require('node:assert/strict')
const { createWebConsoleApp } = require('./app.ts') as {
  createWebConsoleApp(options?: any): import('express').Express
}

type SendOneResult = import('../../../integrations/telegram/types.ts').SendOneResult

function success(chatId: string, text: string): SendOneResult {
  return {
    kind: 'telegram-response',
    response: {
      ok: true,
      result: {
        message_id: 77,
        date: 1_700_000_000,
        chat: { id: Number(chatId), type: 'private', first_name: 'Route test' },
        text
      }
    }
  }
}

function clientFailure(stage: import('../../../integrations/telegram/types.ts').ClientFailureStage): SendOneResult {
  return {
    kind: 'client-failure',
    failure: {
      stage,
      error: { name: 'TestFailure', message: `${stage} failed` }
    }
  }
}

async function listen(app: import('express').Express) {
  return await new Promise<{ baseUrl: string; close(): Promise<void> }>(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address() as import('node:net').AddressInfo
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()))
      })
    })
  })
}

async function post(baseUrl: string, path: string, body: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Bot-Api-Token': token } : {})
    },
    body: JSON.stringify(body)
  })
  return { response, body: await response.json() }
}

async function runTests(): Promise<void> {
  const previousToken = process.env.WEB_CONSOLE_BOT_API_TOKEN
  const previousDb = process.env.APP_DB
  process.env.WEB_CONSOLE_BOT_API_TOKEN = 'route-test-token'
  process.env.APP_DB = 'noco'

  const calls: Array<Record<string, unknown>> = []
  const telegramIntegration = {
    async sendOne(input: { chatId: string; text: string }): Promise<SendOneResult> {
      calls.push(input)
      if (input.chatId === 'api-error') {
        return {
          kind: 'telegram-response',
          response: {
            ok: false,
            error_code: 429,
            description: 'Too Many Requests',
            parameters: { retry_after: 3 }
          }
        }
      }
      if (input.chatId.startsWith('failure-')) {
        return clientFailure(input.chatId.slice('failure-'.length) as import('../../../integrations/telegram/types.ts').ClientFailureStage)
      }
      return success(input.chatId, input.text)
    },
    async sendMany(input: Record<string, { text: string }>) {
      const results: Record<string, SendOneResult> = {}
      for (const [chatId, message] of Object.entries(input)) {
        results[chatId] = await this.sendOne({ chatId, ...message })
      }
      return results
    },
    commands: { register() {}, async dispatch() { return { kind: 'unhandled', reason: 'not-a-command' as const } } }
  }

  const server = await listen(createWebConsoleApp({ useMockData: true, telegramIntegration }))
  try {
    let result = await post(server.baseUrl, '/api/bot/telegram/send-one', {
      chatId: '10', text: 'unauthorized', VEU_SUPPORT_BOT: 'route-test-token'
    })
    assert.equal(result.response.status, 401)
    assert.equal(calls.length, 0)

    result = await post(server.baseUrl, '/api/bot/telegram/send-one', { chatId: '10', text: 'hello' }, 'route-test-token')
    assert.equal(result.response.status, 200)
    assert.equal(result.body.kind, 'telegram-response')
    assert.equal(result.body.response.result.text, 'hello')

    result = await post(server.baseUrl, '/api/bot/telegram/send-one', { chatId: 'api-error', text: 'retry' }, 'route-test-token')
    assert.equal(result.response.status, 200)
    assert.equal(result.body.response.ok, false)
    assert.equal(result.body.response.parameters.retry_after, 3)

    const expectedStatuses = {
      validation: 400,
      configuration: 503,
      transport: 502,
      response: 502,
      internal: 500
    }
    for (const [stage, expectedStatus] of Object.entries(expectedStatuses)) {
      result = await post(server.baseUrl, '/api/bot/telegram/send-one', {
        chatId: `failure-${stage}`,
        text: 'failure'
      }, 'route-test-token')
      assert.equal(result.response.status, expectedStatus)
      assert.equal(result.body.failure.stage, stage)
    }

    result = await post(server.baseUrl, '/api/bot/telegram/send-many', {
      '11': { text: 'first' },
      'api-error': { text: 'second' },
      'failure-transport': { text: 'third' }
    }, 'route-test-token')
    assert.equal(result.response.status, 200)
    assert.equal(result.body['11'].response.ok, true)
    assert.equal(result.body['api-error'].response.ok, false)
    assert.equal(result.body['failure-transport'].failure.stage, 'transport')

    result = await post(server.baseUrl, '/api/bot/telegram/send-many', [], 'route-test-token')
    assert.equal(result.response.status, 400)
    assert.equal(result.body.failure.stage, 'validation')
  } finally {
    await server.close()
    if (previousToken === undefined) delete process.env.WEB_CONSOLE_BOT_API_TOKEN
    else process.env.WEB_CONSOLE_BOT_API_TOKEN = previousToken
    if (previousDb === undefined) delete process.env.APP_DB
    else process.env.APP_DB = previousDb
  }
}

runTests()
  .then(() => console.log('telegram integration route tests passed'))
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
