const WINDOW_MS = 10 * 60_000
const MAX_ATTEMPTS = 5

export function connectionSearchSlot(attempts: string[], now: number, minimumGapMs: number) {
  const recent = attempts.map(value => Date.parse(value))
    .filter(value => Number.isFinite(value) && value > now - WINDOW_MS)
    .sort((left, right) => left - right)
  const last = recent.at(-1)
  const gapDelay = last === undefined ? 0 : Math.max(0, last + minimumGapMs - now)
  const windowDelay = recent.length < MAX_ATTEMPTS ? 0 :
    Math.max(0, recent[recent.length - MAX_ATTEMPTS] + WINDOW_MS - now)
  return {
    recent: recent.map(value => new Date(value).toISOString()),
    delayMs: Math.max(gapDelay, windowDelay),
    waitKind: windowDelay > gapDelay ? 'search_batch_cooldown' as const : 'search_pacing' as const
  }
}
