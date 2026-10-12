import type { Page, Route } from 'playwright'
import { isLinkedInUrl } from '../../infrastructure/navigation-policy.ts'

/** Keep requests in Chromium; never use Node route.fetch to simulate browser networking. */
export async function guardJevNetwork(page: Page, allowedUrl: (url: string) => boolean) {
  const context = page.context(), network = await context.newCDPSession(page)
  const route = async (r: Route) => {
    let owner: Page
    // First popup requests can arrive before Playwright has an associated frame.
    // Unknown ownership is not permission to send a request.
    try { owner = r.request().frame().page() } catch { await r.abort().catch(() => {}); return }
    if (owner !== page && await owner.opener() !== page) { await r.fallback(); return }
    if (owner !== page || isLinkedInUrl(r.request().url()) || !['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ||
        (r.request().isNavigationRequest() && !allowedUrl(r.request().url()))) { await r.abort().catch(() => {}); return }
    await r.fallback()
  }
  let failure: Error | undefined
  const pending = new Set<Promise<void>>()
  const paused = (event: any) => {
    const work = (async () => {
      const location = event.responseHeaders?.find((h: any) => h.name.toLowerCase() === 'location')?.value
      const redirect = [301, 302, 303, 307, 308].includes(event.responseStatusCode) && location
      const unsafe = redirect && !allowedUrl(new URL(location, event.request.url).href)
      const download = event.responseHeaders?.some((h: any) => h.name.toLowerCase() === 'content-disposition' && /^attachment\b/i.test(h.value))
      if (unsafe || download) await network.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' })
      else await network.send('Fetch.continueRequest', { requestId: event.requestId })
    })().catch(async error => {
      failure = new Error('jev_network_guard_failed', { cause: error })
      await page.close().catch(() => {})
    })
    pending.add(work); void work.finally(() => pending.delete(work))
  }
  network.on('Fetch.requestPaused', paused)
  try {
    await network.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] })
    await context.route('**/*', route)
  } catch (error) { await network.detach().catch(() => {}); throw error }
  return {
    assertHealthy() { if (failure) throw failure },
    async close() {
      await context.unroute('**/*', route)
      await Promise.allSettled([...pending])
      network.off('Fetch.requestPaused', paused)
      await network.detach().catch(() => {})
    }
  }
}
