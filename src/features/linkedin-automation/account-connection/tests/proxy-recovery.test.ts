const assert = require('node:assert/strict')
const { resolveOrPromptLinkedInProxy } = require('../proxy-recovery.ts') as {
  resolveOrPromptLinkedInProxy(id: number, dependencies: any): Promise<any>
}

async function run(): Promise<void> {
  let reads = 0
  let attached: any
  const proxy = await resolveOrPromptLinkedInProxy(9, {
    async getProfile() {
      reads += 1
      return reads === 1
        ? { id: 9 }
        : { proxy: { type: 'http', host: 'new.test', port: 8080, login: 'u', password: 'p' } }
    },
    async prompt() {
      return { type: 'http', host: 'new.test', port: 8080, login: 'u', password: 'p' }
    },
    async attach(id: number, value: any) { attached = { id, value } }
  })
  assert.equal(proxy.host, 'new.test')
  assert.equal(attached.id, 9)
  assert.equal(attached.value.password, 'p')

  await assert.rejects(
    resolveOrPromptLinkedInProxy(10, {
      async getProfile() {
        return { proxy: { type: 'ssh', host: 'bad.test', port: 22 } }
      },
      async prompt() { throw new Error('must not prompt') },
      async attach() {}
    }),
    (error: any) => error.code === 'dolphin_proxy_protocol_unsupported'
  )
}

module.exports = { run }
