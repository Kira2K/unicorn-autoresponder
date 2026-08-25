function createLinkedInOperationGate() {
  const active = new Map<string, { kind: string; id: string; accountKey?: string }>()
  return {
    acquire(kind: string, id: string, accountKey?: string) {
      const key = accountKey ? `account:${accountKey}` : '*'
      if (active.has('*') || active.has(key) || (!accountKey && active.size)) {
        throw Object.assign(new Error('Another LinkedIn operation is active.'), {
        code: 'linkedin_operation_active'
      })
      }
      active.set(key, { kind, id, ...(accountKey ? { accountKey } : {}) })
      let released = false
      return () => {
        const current = active.get(key)
        if (!released && current?.kind === kind && current.id === id) active.delete(key)
        released = true
      }
    },
    current(accountKey?: string) {
      const value = accountKey ? active.get(`account:${accountKey}`) ?? active.get('*')
        : active.values().next().value
      return value && { ...value }
    }
  }
}

module.exports = { createLinkedInOperationGate }
