export type LinkedInOperationGateOptions = { resolveKey?(key: string): string; assertAvailable?(): void;
  beforeAcquire?(kind: string, id: string, key?: string): void;
  blocked?(kind: string, id: string, key?: string): void; acquired?(kind: string, id: string, key?: string): void }
function createLinkedInOperationGate(options: LinkedInOperationGateOptions = {}) {
  const active = new Map<string, { kind: string; id: string; accountKey?: string }>()
  return {
    acquire(kind: string, id: string, accountKey?: string) {
      options.assertAvailable?.()
      if (accountKey) accountKey = options.resolveKey?.(accountKey) ?? accountKey
      options.beforeAcquire?.(kind, id, accountKey)
      const key = accountKey ? `account:${accountKey}` : '*'
      if (active.has('*') || active.has(key) || (!accountKey && active.size)) {
        options.blocked?.(kind, id, accountKey)
        throw Object.assign(new Error('Another LinkedIn operation is active.'), {
        code: 'linkedin_operation_active'
      })
      }
      active.set(key, { kind, id, ...(accountKey ? { accountKey } : {}) })
      options.acquired?.(kind, id, accountKey)
      let released = false
      return () => {
        const current = active.get(key)
        if (!released && current?.kind === kind && current.id === id) active.delete(key)
        released = true
      }
    },
    current(accountKey?: string) {
      if (accountKey) accountKey = options.resolveKey?.(accountKey) ?? accountKey
      const value = accountKey ? active.get(`account:${accountKey}`) ?? active.get('*')
        : active.values().next().value
      return value && { ...value }
    }
  }
}

module.exports = { createLinkedInOperationGate }
