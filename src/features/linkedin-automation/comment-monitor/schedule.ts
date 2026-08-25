export const DAY_MS = 24 * 60 * 60 * 1_000
export const SESSION_MS = 2 * DAY_MS

export function randomBetween(min: number, max: number, random = Math.random) {
  return Math.round(min + (max - min) * Math.min(1, Math.max(0, random())))
}

export function nextCheckDelay(elapsedMs: number, random = Math.random) {
  return elapsedMs < DAY_MS
    ? randomBetween(25 * 60_000, 35 * 60_000, random)
    : randomBetween(120 * 60_000, 150 * 60_000, random)
}

export function replyDelay(random = Math.random) {
  return randomBetween(45_000, 120_000, random)
}

export function nextCheckAt(startedAt: string, nowMs = Date.now(), random = Math.random) {
  const expiresAt = Date.parse(startedAt) + SESSION_MS
  if (nowMs >= expiresAt) return undefined
  return new Date(Math.min(expiresAt, nowMs + nextCheckDelay(nowMs - Date.parse(startedAt), random)))
    .toISOString()
}
