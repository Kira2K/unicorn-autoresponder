const { getDolphinProfileWithProxy } = require('../../../integrations/dolphin/index.ts') as {
  getDolphinProfileWithProxy(id: number): Promise<any>
}
const { resolveLinkedInProxy, safeProxySummary } = require('./proxy.ts') as {
  resolveLinkedInProxy(profile: any): any
  safeProxySummary(proxy: any): any
}
const { RECOVERABLE_CODES } = require('./proxy-notifier.ts') as {
  RECOVERABLE_CODES: Set<string>
}

async function inspectLinkedInDolphinProfile(
  profileId: number,
  getProfile: (id: number) => Promise<any> = getDolphinProfileWithProxy
) {
  try {
    const proxy = resolveLinkedInProxy(await getProfile(profileId))
    return { summary: safeProxySummary(proxy) }
  } catch (error: any) {
    if (!RECOVERABLE_CODES.has(error?.code)) throw error
    return { summary: { configured: false, requiredOnApply: true } }
  }
}

module.exports = { inspectLinkedInDolphinProfile }
