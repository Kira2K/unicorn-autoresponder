import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import { mkdirSync, createWriteStream } from 'node:fs'
import { createServer } from 'node:net'
export const POST_API_PORT = 4370
export const POST_UI_PORT = 4371
export const postRoot = resolve(process.cwd())
export function startPostTestProcesses(apiPort = POST_API_PORT, uiPort = POST_UI_PORT) {
  const directory = join(postRoot, 'logs/post-writer-checks')
  mkdirSync(directory, { recursive: true })
  const env = { ...process.env, WEB_CONSOLE_USE_MOCK_DATA: 'true', NOCODB_API_TOKEN: 'mock',
    NOCODB_BASE_URL: 'http://127.0.0.1:1', LINKEDIN_POST_WRITER_ENABLED: 'false',
    WEB_CONSOLE_HOST: '127.0.0.1', WEB_CONSOLE_PORT: String(apiPort),
    WEB_CONSOLE_API_URL: `http://127.0.0.1:${apiPort}` }
  const start = (args: string[], name: string) => {
    const child = spawn(process.execPath, args, { cwd: postRoot, env, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] })
    const log = createWriteStream(join(directory, `${name}.log`))
    child.stdout.pipe(log)
    child.stderr.pipe(log)
    child.once('exit', () => log.end())
    return child
  }
  const vite = join(postRoot, 'node_modules/vite/bin/vite.js')
  const backend = start(['src/features/web-console/backend/index.ts'], 'mock-backend')
  const frontend = start([vite, '--config', 'src/features/web-console/frontend/vite.config.js',
    '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], 'mock-frontend')
  return { backend, frontend, apiPort, uiPort, close() { backend.kill(); frontend.kill() } }
}
export async function waitPostHttp(url: string, child?: ReturnType<typeof spawn>) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error('Mock process exited before becoming ready')
    }
    try { if ((await fetch(url)).status < 500) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Mock HTTP not ready: ${url}`)
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return server.close(() => reject(new Error('No test port')))
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}
export async function startIsolatedPostTestProcesses() {
  const apiPort = await freePort()
  let uiPort = await freePort()
  while (uiPort === apiPort) uiPort = await freePort()
  return startPostTestProcesses(apiPort, uiPort)
}
