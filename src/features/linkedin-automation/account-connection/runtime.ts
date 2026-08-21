const { createLinkedInAuthNocoRepository } = require('./noco-repository.ts') as {
  createLinkedInAuthNocoRepository(): any
}
const { collectLinkedInSession } = require('./session-collector.ts') as {
  collectLinkedInSession(id: number, url: string, dependencies?: any, logger?: any): Promise<any>
}
const { inspectLinkedInDolphinProfile } = require('./dolphin-inspector.ts') as {
  inspectLinkedInDolphinProfile(profileId: number): Promise<any>
}
const {
  createUnipileAccountAdapter,
  unipileProxyProtocol
} = require('../../../integrations/unipile/account-adapter.ts') as Record<string, (...args: any[]) => any>

function createLinkedInAuthDependencies(options: {
  apply: boolean
  logger?: import('./auth-logger.ts').AuthLogger
  repository?: any
}): import('./types.ts').LinkedInAuthDependencies {
  return {
    repository: options.repository ?? createLinkedInAuthNocoRepository(),
    adapter: options.apply ? createUnipileAccountAdapter() : undefined,
    collectSession(profileId: number, expectedUrl: string, logger: any) {
      return collectLinkedInSession(profileId, expectedUrl, undefined, logger)
    },
    inspectProfile: inspectLinkedInDolphinProfile,
    logger: options.logger,
    unipileProxyProtocol
  }
}

module.exports = { createLinkedInAuthDependencies }
