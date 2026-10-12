import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import type { BrowserContext } from 'playwright'
import { isLinkedInUrl } from './navigation-policy.ts'
const require = createRequire(import.meta.url)
const { AUTOMATION_LOCK_TAG, AUTOMATION_LOCK_STATUS_NAME } = require('../../hh-responses/orchestrator/config.ts')
const runtime = require('../../../integrations/dolphin/runtime.ts') as { startDolphinProfile(id: number, options: { headless: boolean; refuseIfBusy: boolean; owner: string }): Promise<{ automation?: { port?: number } }>; stopDolphinProfile(id: number): Promise<void> }
const preflight = require('../../../integrations/dolphin/preflight.ts') as { assertDolphinAppRunning(): Promise<void> }
const profiles = require('../../../integrations/dolphin/profile-proxy.ts') as { getDolphinProfileWithProxy(id: number): Promise<any> }
export const dolphinDependencies = {
  ready: preflight.assertDolphinAppRunning,
  profile: profiles.getDolphinProfileWithProxy,
  start: runtime.startDolphinProfile,
  stop: runtime.stopDolphinProfile,
  driver: () => ({ chromium: require('patchright').chromium, version: require('patchright/package.json').version })
}
/** Attach to the existing profile via shared Dolphin lifecycle; never create/repair a proxy. */
export async function createDolphinBrowser(input: { profileId: number; owner: string; event: (data: Record<string, unknown>) => Promise<void> }, deps = dolphinDependencies): Promise<BrowserContext> {
  await deps.ready()
  const profile = await deps.profile(input.profileId)
  if (profile.tags?.includes(AUTOMATION_LOCK_TAG) || profile.status?.name === AUTOMATION_LOCK_STATUS_NAME) throw Error('dolphin_profile_busy')
  if (!profile?.proxy || !(profile.proxy.host || profile.proxy.server || profile.proxy.ip)) throw Error('dolphin_proxy_missing')
  const library = deps.driver(), sessionId = randomUUID()
  let start: Awaited<ReturnType<typeof deps.start>>
  try { start = await deps.start(input.profileId, { headless: false, refuseIfBusy: true, owner: input.owner }) }
  catch (error: any) {
    // Shared ownership uses exclusive files. A racing owner must never trigger cleanup.
    if (error?.code === 'EEXIST' && String(error?.path ?? '').replace(/\\/g, '/').endsWith(`/dolphin-ownership/${input.profileId}.json`)) throw Error('dolphin_profile_busy')
    if (error?.details?.errorObject?.code === 'E_BROWSER_RUN_DUPLICATE') throw Error('dolphin_profile_busy')
    throw error
  }
  let browser: any
  try {
    if (!start.automation?.port) throw Error('dolphin_automation_endpoint_missing')
    browser = await library.chromium.connectOverCDP(`http://127.0.0.1:${start.automation.port}`, { timeout: 30000 })
    const context = browser.contexts()[0] as BrowserContext | undefined
    if (!context) throw Error('dolphin_persistent_context_missing')
    const route: Parameters<BrowserContext['route']>[1] = r => isLinkedInUrl(r.request().url()) ? r.abort() : r.continue()
    await context.route('**/*', route)
    let closed = false
    context.close = async () => {
      if (closed) return; closed = true
      await context.unroute('**/*', route).catch(() => {})
      try { await browser.close() } finally { await deps.stop(input.profileId) }
    }
    await input.event({ action: 'dolphin_connected', sessionId, profileId: input.profileId, driver: 'patchright', driverVersion: library.version, browserVersion: browser.version(), proxyConfigured: true })
    return context
  } catch (error) { await browser?.close().catch(() => {}); await deps.stop(input.profileId).catch(() => {}); throw error }
}
