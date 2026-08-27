function createLinkedInOperationGate() {
  let active: { kind: string; id: string } | undefined
  return {
    acquire(kind: string, id: string) {
      if (active) throw Object.assign(new Error('Another LinkedIn operation is active.'), {
        code: 'linkedin_operation_active'
      })
      active = { kind, id }
      let released = false
      return () => {
        if (!released && active?.kind === kind && active.id === id) active = undefined
        released = true
      }
    },
    current() { return active && { ...active } }
  }
}

module.exports = { createLinkedInOperationGate }
