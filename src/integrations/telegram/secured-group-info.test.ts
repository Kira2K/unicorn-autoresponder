const assert = require('node:assert/strict')
const { findSecuredGroup, normalizeTelegramTag } = require('./secured-group-info.ts') as import('./secured-group-info.ts').SecuredGroupModule
const { handleSupportBotMessage, registerSupportBotCommands, createSupportBotApiClient } = require('./support-bot.ts')

async function run() {
  const row = { clientName: 'Test', chatId: '-456', invitationLink: 'https://t.me/+fake_test' }
  for (const tag of ['@VERY_EVIL_UNICORN', 'very_evil_unicorn', '  @Very_Evil_Unicorn  ']) {
    assert.equal(normalizeTelegramTag(tag), 'very_evil_unicorn')
    assert.equal((await findSecuredGroup(tag, async value => { assert.equal(value, 'very_evil_unicorn'); return [row] })).kind, 'found')
  }
  assert.equal((await findSecuredGroup('', async () => { throw Error('must not read') })).kind, 'missing-username')
  assert.equal((await findSecuredGroup('unknown', async () => [])).kind, 'unknown-student')
  assert.equal((await findSecuredGroup('duplicate', async () => [row, row])).kind, 'ambiguous-student')
  for (const invalid of [{ ...row, chatId: '' }, { ...row, invitationLink: '' }, { ...row, invitationLink: 'https://evil.test/' }]) {
    assert.equal((await findSecuredGroup('test', async () => [invalid])).kind, 'link-unavailable')
  }
  await assert.rejects(findSecuredGroup('test', async () => { throw Error('SQL unavailable') }))
  const message = { message_id: 1, date: 1, chat: { id: 123, type: 'private' }, from: { id: 123, username: 'own_tag' }, text: '/start @someone_else' }
  const api = {
    myGroupInfo: async (tag: string) => { assert.equal(tag, 'own_tag'); return { kind: 'found', ...row } },
    findClient: async () => ({ found: true, client: { name: 'Legacy' } })
  }
  const first = await handleSupportBotMessage(message, api)
  assert.equal(first.replyMarkup.inline_keyboard[0][0].url, row.invitationLink)
  assert.doesNotMatch(first.text, /fake_test/)
  assert.match(await handleSupportBotMessage({ ...message, chat: { id: -456, type: 'group' } }, api), /Legacy/)
  const missing = await handleSupportBotMessage({ ...message, from: { id: 123 } }, api)
  assert.match(missing.text, /Установи Telegram username/)
  const unknown = await handleSupportBotMessage(message, { ...api, myGroupInfo: async () => ({ kind: 'unknown-student' }) })
  assert.equal(unknown.replyMarkup, undefined)
  const unavailable = await handleSupportBotMessage(message, { ...api, myGroupInfo: async () => { throw Object.assign(Error(), { code: 'backend_unavailable' }) } })
  assert.match(unavailable, /недоступен/)
  const handlers = new Map<string, any>()
  registerSupportBotCommands({ commands: { register: (name: string, handler: any) => handlers.set(name, handler) } }, api)
  let attempts = 0
  await handlers.get('/start')({ message, reply: async () => { attempts++; return { kind: 'client-failure' } } })
  assert.equal(attempts, 1)
  attempts = 0
  await assert.rejects(handlers.get('/start')({ message, reply: async () => { attempts++; throw Error('transport failed') } }))
  assert.equal(attempts, 1)
  const client = createSupportBotApiClient({ token: 'fake', requester: async (url: string, options: any) => {
    assert.match(url, /\/api\/bot\/telegram\/my-group-info$/)
    assert.deepEqual(JSON.parse(options.body), { username: 'own_tag' })
    assert.equal(options.headers['X-Bot-Api-Token'], 'fake')
    return new Response(JSON.stringify({ kind: 'unknown-student' }))
  } })
  assert.equal((await client.myGroupInfo('own_tag')).kind, 'unknown-student')
  console.log('secured group info tests passed')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
