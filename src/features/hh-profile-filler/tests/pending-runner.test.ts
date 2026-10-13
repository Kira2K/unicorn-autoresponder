import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runPending, scanTransitions } from '../pending-runner.ts'
import { main } from '../cli.ts'

export async function runPendingRunnerTests() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-manual-only-'))
  const statePath = path.join(directory, 'state.json')
  const state = JSON.stringify({ jobs: [{ clientId: 7, market: 'En', status: 'pending' }] })
  fs.writeFileSync(statePath, state)
  try {
    for (const invoke of [
      () => runPending({ statePath }),
      () => runPending({ statePath, scanOnly: true }),
      () => scanTransitions({ statePath }),
      () => main(['--pending', '--state', statePath]),
      () => main(['--scan-only', '--state', statePath]),
      () => main(['--pending', '--client-id', '7', '--market', 'en'])
    ]) {
      await assert.rejects(invoke, { code: 'profile_manual_only' })
      assert.equal(fs.readFileSync(statePath, 'utf8'), state)
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
