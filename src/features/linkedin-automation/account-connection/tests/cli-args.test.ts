const assert = require('node:assert/strict')
const { parseLinkedInAuthArgs } = require('../cli-args.ts') as {
  parseLinkedInAuthArgs(args: string[]): any
}

async function run(): Promise<void> {
  assert.deepEqual(parseLinkedInAuthArgs(['--client', 'Kira']), {
    apply: false, forceReauth: false, help: false,
    clientName: 'Kira'
  })
  const apply = parseLinkedInAuthArgs([
    '--client=Kira', '--platform-account-id=42', '--apply', '--force-reauth'
  ])
  assert.equal(apply.platformAccountId, 42)
  assert.equal(apply.apply, true)
  assert.equal(apply.forceReauth, true)
  assert.throws(() => parseLinkedInAuthArgs([]), (error: any) => error.code === 'cli_client_missing')
  assert.throws(
    () => parseLinkedInAuthArgs(['--client', 'Kira', '--force-reauth']),
    (error: any) => error.code === 'cli_force_requires_apply'
  )
}

module.exports = { run }
