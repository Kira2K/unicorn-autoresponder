// Noco has no conditional PATCH. Serialize CV writes in the owning backend process.
// SQL uses a database row lock instead, including across backend instances.
const queues = new WeakMap<object, Map<number, Promise<void>>>()

export async function withResumeWriteLock<T>(owner: object, id: number, run: () => Promise<T>): Promise<T> {
  let byId = queues.get(owner)
  if (!byId) { byId = new Map(); queues.set(owner, byId) }
  const previous = byId.get(id) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  byId.set(id, current)
  await previous
  try { return await run() }
  finally {
    release()
    if (byId.get(id) === current) byId.delete(id)
  }
}
