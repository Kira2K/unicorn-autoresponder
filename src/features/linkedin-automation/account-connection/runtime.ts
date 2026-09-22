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
  authority?: import('../orchestrator/contracts.ts').ExecutionAuthority
}): import('./types.ts').LinkedInAuthDependencies {
  const raw = options.apply ? createUnipileAccountAdapter() : undefined
  const adapter = raw && options.authority ? new Proxy(raw,{get(target,key) {
    const value=target[key]
    if(key==='authenticateLinkedIn') return async (...args:any[]) => {
      await options.authority!.check(); return value.apply(target,args)
    }
    return typeof value === 'function' ? value.bind(target) : value
  }}) : raw
  return {
    repository: options.repository ?? createLinkedInAuthNocoRepository(),
    adapter,
    async collectSession(profileId: number, expectedUrl: string, logger: any) {
      await options.authority?.check()
      return collectLinkedInSession(profileId, expectedUrl, undefined, logger)
    },
    inspectProfile: inspectLinkedInDolphinProfile,
    logger: options.logger,
    unipileProxyProtocol
  }
}

module.exports = { createLinkedInAuthDependencies }
