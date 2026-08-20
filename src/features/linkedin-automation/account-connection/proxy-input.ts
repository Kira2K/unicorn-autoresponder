const readline = require('node:readline/promises')
const { Writable } = require('node:stream')
const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}

function parseProxyUrl(value: string) {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new LinkedInAuthError(
      'dolphin_proxy_input_invalid',
      'Proxy must use protocol://login:password@host:port format.'
    )
  }
  const type = url.protocol.replace(/:$/, '').toLowerCase()
  const port = Number(url.port)
  if (!['http', 'socks4', 'socks5'].includes(type) || !url.hostname || !port) {
    throw new LinkedInAuthError(
      'dolphin_proxy_input_invalid',
      'Proxy protocol must be http, socks4 or socks5 and include host and port.'
    )
  }
  return {
    type, host: url.hostname, port,
    login: decodeURIComponent(url.username) || undefined,
    password: decodeURIComponent(url.password) || undefined
  }
}

async function readHiddenLine(prompt: string, input: any = process.stdin, target: any = process.stdout) {
  if (!input.isTTY) {
    throw new LinkedInAuthError(
      'dolphin_proxy_input_unavailable',
      'A proxy is missing. Retry from an interactive terminal and enter it when prompted.'
    )
  }
  let muted = false
  const output = new Writable({
    write(chunk: any, _encoding: string, done: () => void) {
      if (!muted) target.write(chunk)
      done()
    }
  })
  const terminal = readline.createInterface({ input, output, terminal: true })
  try {
    const answer = terminal.question(prompt)
    muted = true
    const value = await answer
    target.write('\n')
    return value
  } finally {
    terminal.close()
  }
}

async function promptForProxy(
  profileId: number,
  read: (prompt: string) => Promise<string> = readHiddenLine
) {
  const value = await read(
    `Dolphin profile ${profileId} has no readable proxy. Enter hidden proxy URL ` +
    '(http|socks4|socks5://login:password@host:port): '
  )
  if (!value.trim()) {
    throw new LinkedInAuthError('dolphin_proxy_input_cancelled', 'Proxy entry was cancelled.')
  }
  return parseProxyUrl(value)
}

module.exports = { parseProxyUrl, promptForProxy, readHiddenLine }
