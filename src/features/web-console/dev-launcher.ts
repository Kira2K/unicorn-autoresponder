const { spawn, spawnSync } = require('node:child_process')

type SpawnedProcess = import('node:child_process').ChildProcess

const DEFAULT_BACKEND_PORT = 4300
const DEFAULT_FRONTEND_PORT = 4301

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].filter(value => Number.isInteger(value) && value > 0)
}

function parseWindowsNetstatListeners(output: string, ports: number[]): number[] {
  const targetPorts = new Set(ports.map(Number))
  const pids: number[] = []

  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5 || !['TCP', 'UDP'].includes(parts[0])) continue

    const localAddress = parts[1] ?? ''
    const state = parts[3] ?? ''
    const pidText = parts[4] ?? ''
    const portText = localAddress.slice(localAddress.lastIndexOf(':') + 1)
    const port = Number(portText)
    const pid = Number(pidText)

    if (targetPorts.has(port) && state === 'LISTENING' && Number.isInteger(pid) && pid > 0) {
      pids.push(pid)
    }
  }

  return uniqueNumbers(pids)
}

function buildWindowsKillCommand(pid: number): { command: string; args: string[]; display: string } {
  return {
    command: 'taskkill',
    args: ['/PID', String(pid), '/F', '/T'],
    display: `taskkill /PID ${pid} /F /T`
  }
}

function killWindowsProcessTree(pid: number): void {
  const kill = buildWindowsKillCommand(pid)
  const result = spawnSync(kill.command, kill.args, { encoding: 'utf8' })
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(
      `Failed to clear stale web-console process ${pid}.\n` +
      `Run this command as Administrator, then start again:\n${kill.display}\n` +
      (details ? `\n${details}` : '')
    )
  }
}

function findWindowsListeners(ports: number[]): number[] {
  const result = spawnSync('netstat', ['-ano'], { encoding: 'utf8' })
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`Could not inspect web-console ports with netstat -ano.${details ? `\n${details}` : ''}`)
  }
  return parseWindowsNetstatListeners(result.stdout, ports)
}

function clearWebConsolePorts(ports: number[]): number[] {
  if (process.platform !== 'win32') {
    throw new Error('web:dev port cleanup is currently implemented for Windows only.')
  }
  const pids = findWindowsListeners(ports)
  for (const pid of pids) {
    killWindowsProcessTree(pid)
  }
  return pids
}

function spawnManaged(label: string, command: string, args: string[], env: NodeJS.ProcessEnv): SpawnedProcess {
  const commandWithArgs = process.platform === 'win32'
    ? {
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', [command, ...args].join(' ')]
      }
    : { command, args }
  const child = spawn(commandWithArgs.command, commandWithArgs.args, {
    env,
    shell: false,
    stdio: ['inherit', 'pipe', 'pipe']
  })

  child.stdout?.on('data', (data: Buffer) => process.stdout.write(`[${label}] ${String(data)}`))
  child.stderr?.on('data', (data: Buffer) => process.stderr.write(`[${label}] ${String(data)}`))
  return child
}

function terminateChildren(children: SpawnedProcess[]): void {
  for (const child of children) {
    if (child.exitCode === null && !child.killed && child.pid) {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/F', '/T'], { stdio: 'ignore' })
      } else {
        child.kill('SIGTERM')
      }
    }
  }
}

function runDevLauncher(): void {
  const backendPort = Number(process.env.WEB_CONSOLE_PORT ?? DEFAULT_BACKEND_PORT)
  const frontendPort = Number(process.env.WEB_CONSOLE_FRONTEND_PORT ?? DEFAULT_FRONTEND_PORT)
  const ports = uniqueNumbers([backendPort, frontendPort])

  console.log(`Preparing web console dev ports: ${ports.join(', ')}`)
  const cleared = clearWebConsolePorts(ports)
  if (cleared.length) {
    console.log(`Cleared stale web-console process ids: ${cleared.join(', ')}`)
  }

  const env = { ...process.env }
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const children = [
    spawnManaged('backend', npmCommand, ['run', 'web:backend:dev'], env),
    spawnManaged('frontend', npmCommand, ['run', 'web:frontend'], env)
  ]
  let shuttingDown = false

  const shutdown = (code: number): void => {
    if (shuttingDown) return
    shuttingDown = true
    terminateChildren(children)
    process.exitCode = code
  }

  for (const child of children) {
    child.on('exit', (code, signal) => {
      if (shuttingDown) return
      console.error(`web:dev child exited unexpectedly: ${signal ?? code}`)
      shutdown(typeof code === 'number' && code !== 0 ? code : 1)
    })
  }

  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))
}

if (require.main === module) {
  try {
    runDevLauncher()
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

module.exports = {
  buildWindowsKillCommand,
  clearWebConsolePorts,
  DEFAULT_BACKEND_PORT,
  DEFAULT_FRONTEND_PORT,
  parseWindowsNetstatListeners,
  runDevLauncher,
  uniqueNumbers
}
