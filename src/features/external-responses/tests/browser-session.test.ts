import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createBrowserSession, parseBrowserDriver } from '../infrastructure/browser.ts'
import { prepareBrowserProfile } from '../infrastructure/browser-profile.ts'

test('driver selection is explicit, preserves Playwright default, and rejects misspellings', () => {
  assert.equal(parseBrowserDriver(), 'playwright')
  assert.equal(parseBrowserDriver('patchright'), 'patchright')
  assert.throws(() => parseBrowserDriver('patchrigth'), /browser driver/i)
})

test('Patchright launch records runtime metadata and never falls back after failure', async () => {
  const loads: string[] = [], metadata: any[] = []; let released = 0
  const deps = {
    loadDriver: (name: string) => { loads.push(name); return { version: 'test-version', chromium: { launchPersistentContext: async (_: string, options: any) => {
      assert.equal(options.headless, false); assert.equal(options.viewport, null)
      return { browser: () => ({ version: () => 'browser-version' }), close: async () => {}, on: () => {}, route:async()=>{} } as any
    } } } },
    prepareProfile: async () => ({ release: async () => { released++ }, backupPath: 'backup' })
  }
  const context = await createBrowserSession({ profilePath: 'fixture', driver: 'patchright', onSession: m => { metadata.push(m) } }, deps)
  assert.equal(metadata[0].driver, 'patchright'); assert.equal(metadata[0].driverVersion, 'test-version')
  assert.equal(metadata[0].browserVersion, 'browser-version'); assert.ok(metadata[0].sessionId)
  await context.close(); assert.equal(released, 1)
  await assert.rejects(createBrowserSession({ profilePath: 'fixture', driver: 'patchright' }, {
    ...deps, loadDriver: name => { loads.push(name); throw Error('missing browser') }
  }), /patchright.*missing browser/i)
  assert.deepEqual(loads, ['patchright', 'patchright']); assert.equal(released, 2)
})

test('profile guard rejects active browsers; backup is unchanged and made only once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'external-profile-')), profile = join(root, 'browser')
  try {
    await mkdir(profile); await writeFile(join(profile, 'state'), 'original-session')
    const idle = async () => false, busy = async () => true
    await assert.rejects(prepareBrowserProfile({ profilePath: profile, driver: 'patchright' }, { isInUse: busy }), /in use/i)
    const first = await prepareBrowserProfile({ profilePath: profile, driver: 'patchright' }, { isInUse: idle })
    assert.equal(await readFile(join(first.backupPath!, 'state'), 'utf8'), 'original-session')
    await assert.rejects(prepareBrowserProfile({ profilePath: profile, driver: 'playwright' }, { isInUse: idle }), /leased/i)
    await first.release()
    await writeFile(join(profile, 'state'), 'updated-session')
    const second = await prepareBrowserProfile({ profilePath: profile, driver: 'patchright' }, { isInUse: idle })
    assert.equal(second.backupPath, first.backupPath)
    assert.equal(await readFile(join(second.backupPath!, 'state'), 'utf8'), 'original-session')
    assert.equal(await readFile(join(profile, 'state'), 'utf8'), 'updated-session')
    await second.release()
  } finally { await rm(root, { recursive: true, force: true }) }
})
