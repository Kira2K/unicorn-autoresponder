const {
  createAndAttachDolphinProxy,
  getDolphinProfileWithProxy
} = require('../../../integrations/dolphin/index.ts') as Record<string, (...args: any[]) => Promise<any>>
const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}
const { promptForProxy } = require('./proxy-input.ts') as {
  promptForProxy(id: number): Promise<any>
}
const { resolveLinkedInProxy } = require('./proxy.ts') as {
  resolveLinkedInProxy(profile: any): any
}

const RECOVERABLE_CODES = new Set(['dolphin_proxy_missing', 'dolphin_proxy_invalid'])

async function resolveOrPromptLinkedInProxy(
  profileId: number,
  dependencies: {
    getProfile(id: number): Promise<any>
    prompt(id: number): Promise<any>
    attach(id: number, proxy: any): Promise<void>
  } = {
    getProfile: getDolphinProfileWithProxy,
    prompt: promptForProxy,
    attach: createAndAttachDolphinProxy
  }
) {
  try {
    return resolveLinkedInProxy(await dependencies.getProfile(profileId))
  } catch (error: any) {
    if (!RECOVERABLE_CODES.has(error?.code)) throw error
  }

  const entered = await dependencies.prompt(profileId)
  await dependencies.attach(profileId, entered)
  const resolved = resolveLinkedInProxy(await dependencies.getProfile(profileId))
  if (resolved.host !== entered.host || resolved.port !== entered.port) {
    throw new LinkedInAuthError(
      'dolphin_proxy_attach_mismatch',
      'Dolphin did not attach the entered proxy to the En profile.'
    )
  }
  return resolved
}

module.exports = { RECOVERABLE_CODES, resolveOrPromptLinkedInProxy }
