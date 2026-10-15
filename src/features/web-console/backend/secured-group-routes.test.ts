const assert = require('node:assert/strict')
const { createWebConsoleApp } = require('./app.ts')

async function run() {
  const old = process.env.WEB_CONSOLE_BOT_API_TOKEN
  process.env.WEB_CONSOLE_BOT_API_TOKEN = 'fake-test-token'
  let reads = 0
  const app = createWebConsoleApp({ useMockData: true, repository: {
    async findSecuredGroupByTelegramTag(username: string) {
      reads++
      if (username === 'broken') throw Error('secret invitation must not escape')
      return { kind: 'found', clientName: 'Test', chatId: '-123', invitationLink: 'https://t.me/+fake_test' }
    }
  } })
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const url = `http://127.0.0.1:${server.address().port}/api/bot/telegram/my-group-info`
  async function post(body: unknown, token = 'fake-test-token') {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Token': token }, body: JSON.stringify(body) })
  }
  try {
    assert.equal((await post({ username: 'test' }, 'wrong')).status, 401)
    assert.equal(reads, 0)
    assert.equal((await post({ clientId: 1 })).status, 400)
    assert.equal(reads, 0)
    const found = await post({ username: 'test' })
    assert.equal(found.status, 200)
    assert.equal(found.headers.get('cache-control'), 'no-store')
    assert.equal((await found.json()).invitationLink, 'https://t.me/+fake_test')
    const { createSupportBotApiClient, handleSupportBotMessage } = require('../../../integrations/telegram/support-bot.ts')
    const client = createSupportBotApiClient({ baseUrl: url.replace('/api/bot/telegram/my-group-info', ''), token: 'fake-test-token' })
    const reply = await handleSupportBotMessage({ text: '/start @someone_else', chat: { id: 123, type: 'private' }, from: { id: 123, username: 'test' } }, client)
    assert.equal(reply.replyMarkup.inline_keyboard[0][0].url, 'https://t.me/+fake_test')
    const failed = await post({ username: 'broken' })
    assert.equal(failed.status, 503)
    assert.deepEqual(await failed.json(), { error: 'secured_group_source_unavailable' })
    console.log('secured group route tests passed')
  } finally {
    if (old === undefined) delete process.env.WEB_CONSOLE_BOT_API_TOKEN
    else process.env.WEB_CONSOLE_BOT_API_TOKEN = old
    await new Promise<void>((resolve, reject) => server.close((error: Error) => error ? reject(error) : resolve()))
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
