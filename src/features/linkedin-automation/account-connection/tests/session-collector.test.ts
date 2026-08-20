const assert = require('node:assert/strict')
const { collectLinkedInSession } = require('../session-collector.ts') as {
  collectLinkedInSession(id: number, url: string, dependencies: any): Promise<any>
}

async function run(): Promise<void> {
  const events: string[] = []
  const page = {
    async goto() { events.push('goto') },
    async waitForFunction() {},
    async evaluate() {
      return { profileUrl: 'https://www.linkedin.com/in/kira-test/', userAgent: 'Dolphin Agent' }
    },
    url() { return 'https://www.linkedin.com/in/kira-test/' }
  }
  const context = {
    pages: () => [page],
    async cookies() {
      return [{ name: 'li_at', value: 'li-at-secret', domain: '.linkedin.com', expires: -1 }]
    }
  }
  const result = await collectLinkedInSession(
    200,
    'https://linkedin.com/in/kira-test',
    {
      async acquireLock() {
        events.push('lock')
        return { async release() { events.push('release') } }
      },
      async getProxy() {
        return { protocol: 'http', host: 'proxy.test', port: 8080 }
      },
      async stopProfile() { events.push('stop') },
      async startProfile() {
        events.push('start')
        return { automation: { port: 9000 } }
      },
      playwright() {
        return { chromium: { async connectOverCDP(url: string) {
          assert.equal(url, 'http://127.0.0.1:9000')
          return {
            contexts: () => [context],
            async close() { events.push('close') }
          }
        } } }
      }
    }
  )

  assert.equal(result.session.liAt, 'li-at-secret')
  assert.equal(result.session.userAgent, 'Dolphin Agent')
  assert.equal(result.proxy.host, 'proxy.test')
  assert.deepEqual(events, ['lock', 'stop', 'start', 'goto', 'close', 'stop', 'release'])
}

module.exports = { run }
