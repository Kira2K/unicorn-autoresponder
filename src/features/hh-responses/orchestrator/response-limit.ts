// Remaining quotas are explicit run inputs, never database mutations. Snapshot
// and validate them before starting profiles; missing quotas fail closed.
function createResponseLimitResolver(defaultLimit: number, limits?: Readonly<Record<string, number>>) {
  if (limits === undefined) return (_profileId: number) => defaultLimit
  if (!Number.isSafeInteger(defaultLimit) || defaultLimit < 1) throw Error('Invalid default response limit')
  if (!limits || typeof limits !== 'object' || Array.isArray(limits) || !Object.keys(limits).length) throw Error('Invalid remaining response limits')
  const snapshot = new Map<number, number>()
  for (const [key, limit] of Object.entries(limits)) {
    const id = Number(key)
    if (!Number.isSafeInteger(id) || id < 1 || String(id) !== key || !Number.isSafeInteger(limit) || limit < 1 || limit > defaultLimit) throw Error(`Invalid remaining response limit for Dolphin profile ${key}`)
    snapshot.set(id, limit)
  }
  return (profileId: number) => {
    const limit = snapshot.get(Number(profileId))
    if (limit === undefined) throw Error(`Missing remaining response limit for Dolphin profile ${profileId}`)
    return limit
  }
}
module.exports = { createResponseLimitResolver }
