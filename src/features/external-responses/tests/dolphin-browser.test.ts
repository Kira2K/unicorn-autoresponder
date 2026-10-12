import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDolphinBrowser } from '../infrastructure/dolphin-browser.ts'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
test('Dolphin adapter delegates shared start/proxy/stop, attaches Patchright and never launches local Chromium', async () => {
  const calls: string[] = [], events: any[] = [], context: any = { route: async () => calls.push('route'), unroute: async () => {}, close: async () => { throw Error('must not close persistent context directly') } }
  const deps: any = { ready: async () => calls.push('ready'), profile: async () => ({ proxy: { host: 'proxy' } }), start: async (_: number, options: any) => { assert.equal(options.refuseIfBusy, true); assert.equal(options.headless, false); calls.push('start'); return { automation: { port: 9222 } } }, stop: async () => calls.push('stop'), driver: () => ({ version: 'fixture', chromium: { connectOverCDP: async (url: string) => { assert.equal(url, 'http://127.0.0.1:9222'); calls.push('cdp'); return { contexts: () => [context], version: () => 'fixture', close: async () => calls.push('disconnect') } } } }) }
  const session = await createDolphinBrowser({ profileId: 1, owner: 'test', event: async e => { events.push(e) } }, deps)
  await session.close(); await session.close()
  assert.deepEqual(calls, ['ready', 'start', 'cdp', 'route', 'disconnect', 'stop']); assert.equal(events[0].driver, 'patchright')
  deps.start = async () => { throw Error('busy') }; calls.length = 0
  await assert.rejects(createDolphinBrowser({ profileId: 1, owner: 'test', event: async () => {} }, deps), /busy/)
  assert.deepEqual(calls, ['ready'])
})

test('shared HH stop cannot stop a profile leased by another workflow', async () => {
  const require = createRequire(import.meta.url), ownership = require('../../../integrations/dolphin/ownership.ts'), runtime = require('../../../integrations/dolphin/runtime.ts')
  const directory = await mkdtemp(join(tmpdir(), 'dolphin-ownership-')), previous = process.env.DOLPHIN_LEASE_DIRECTORY
  process.env.DOLPHIN_LEASE_DIRECTORY = directory
  const foreign = JSON.stringify({ profileId: 987654321, token: 'foreign-token', pid: 456, owner: 'external-responses:other' }), path = join(directory, '987654321.json')
  try {
    await writeFile(path, foreign)
    assert.throws(() => ownership.assertDolphinOwnership(987654321), /owned/)
    await assert.rejects(runtime.stopDolphinProfile(987654321), /owned/)
    assert.throws(() => ownership.acquireDolphinOwnership(987654321), /EEXIST/)
    ownership.releaseDolphinOwnership(987654321)
    assert.equal(await readFile(path, 'utf8'), foreign)
  } finally {
    if (previous === undefined) delete process.env.DOLPHIN_LEASE_DIRECTORY; else process.env.DOLPHIN_LEASE_DIRECTORY = previous
    await rm(directory, { recursive: true, force: true })
  }
})
