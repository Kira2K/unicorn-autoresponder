// One response defines one deadline. Passing the same failure through another adapter
// must not restart its wait. New requests produce new errors and may extend the deadline.
const deadlines = new WeakMap<object, number>()
export function providerRetryAt(error: any, now: number, fallbackMs = 0): number {
  const previous = error && typeof error === 'object' ? deadlines.get(error) : undefined
  if (previous !== undefined) return previous
  const absolute = Number(error?.details?.retryAt)
  const supplied = Number(error?.details?.retryAfterMs ?? error?.retryAfterMs)
  const observed = Number(error?.details?.observedAt)
  const at = Number.isFinite(absolute) ? absolute :
    (Number.isFinite(observed) ? observed : now) + (Number.isFinite(supplied) ? supplied : fallbackMs)
  if (error && typeof error === 'object') deadlines.set(error, at)
  return at
}
