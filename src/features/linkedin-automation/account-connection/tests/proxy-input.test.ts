const assert = require('node:assert/strict')
const { parseProxyUrl, promptForProxy } = require('../proxy-input.ts') as Record<string, (...args: any[]) => any>

async function run(): Promise<void> {
  assert.deepEqual(
    parseProxyUrl('socks5://user:p%40ss@proxy.example.com:1080'),
    {
      type: 'socks5', host: 'proxy.example.com', port: 1080,
      login: 'user', password: 'p@ss'
    }
  )
  assert.throws(
    () => parseProxyUrl('https://proxy.example.com:443'),
    (error: any) => error.code === 'dolphin_proxy_input_invalid'
  )
  let prompt = ''
  const entered = await promptForProxy(42, async (value: string) => {
    prompt = value
    return 'http://proxy.example.com:8080'
  })
  assert.equal(prompt.includes('42'), true)
  assert.equal(entered.host, 'proxy.example.com')
}

module.exports = { run }
