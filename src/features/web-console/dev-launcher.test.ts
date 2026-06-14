const assert = require('node:assert/strict')
const {
  buildWindowsKillCommand,
  parseWindowsNetstatListeners,
  uniqueNumbers
} = require('./dev-launcher.ts') as {
  buildWindowsKillCommand(pid: number): { command: string; args: string[]; display: string }
  parseWindowsNetstatListeners(output: string, ports: number[]): number[]
  uniqueNumbers(values: number[]): number[]
}

function runTests(): void {
  assert.deepEqual(uniqueNumbers([4300, 4301, 4300, 0, -1, 4301]), [4300, 4301])

  const netstatOutput = `
  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:4300         0.0.0.0:0              LISTENING       1111
  TCP    127.0.0.1:4300         127.0.0.1:55000        TIME_WAIT       0
  TCP    127.0.0.1:4301         0.0.0.0:0              LISTENING       2222
  TCP    127.0.0.1:4302         0.0.0.0:0              LISTENING       3333
  TCP    [::1]:4301             [::]:0                 LISTENING       4444
  UDP    127.0.0.1:4301         *:*                                    5555
  `

  assert.deepEqual(parseWindowsNetstatListeners(netstatOutput, [4300, 4301]), [1111, 2222, 4444])
  assert.deepEqual(parseWindowsNetstatListeners(netstatOutput, [4302]), [3333])
  assert.deepEqual(parseWindowsNetstatListeners(netstatOutput, [4999]), [])

  const kill = buildWindowsKillCommand(1234)
  assert.equal(kill.command, 'taskkill')
  assert.deepEqual(kill.args, ['/PID', '1234', '/F', '/T'])
  assert.equal(kill.display, 'taskkill /PID 1234 /F /T')
}

runTests()
console.log('web console dev launcher tests passed')
