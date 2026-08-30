const assert = require('node:assert/strict')
const { collectLinkedInSession } = require('../session-collector.ts') as {
  collectLinkedInSession(id: number, url: string, dependencies: any, logger?: any): Promise<any>
}

async function run(): Promise<void> {
  const events: string[] = []
  const logStages: string[] = []
  const logger = {
    event(stage: string) { logStages.push(stage) },
    async run(stage: string, _details: any, action: () => Promise<any>) {
      logStages.push(stage)
      return await action()
    }
  }
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
      async checkLocalApi() { events.push('health') },
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
    },
    logger
  )

  assert.equal(result.session.liAt, 'li-at-secret')
  assert.equal(result.session.userAgent, 'Dolphin Agent')
  assert.equal(result.proxy.host, 'proxy.test')
  assert.deepEqual(events, ['health', 'lock', 'stop', 'start', 'goto', 'close', 'stop', 'release'])
  assert.deepEqual(logStages, [
    'dolphin_local_api_checked', 'profile_lock_acquired', 'profile_stopped',
    'proxy_validated', 'proxy_summary',
    'profile_started', 'cdp_connected', 'linkedin_opened', 'session_validated',
    'session_summary', 'cdp_closed', 'profile_cleanup_stopped', 'profile_lock_released'
  ])
}

module.exports = { run }
