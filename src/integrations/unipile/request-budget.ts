// Share observed limits for the same method/account across feature clients.
// Headers do not identify the scope: do not invent an account-wide suspension
// from a method's quota. Other methods observe their own server responses.
export type RateLimitDetails = {
  retryAfterMs?: number; retryAfterSeconds?: number; rateLimitLimit?: number;
  rateLimitRemaining?: number; rateLimitResetSeconds?: number; rateLimitResetAt?: number
}

export function readRateLimitHeaders(response: any, now = Date.now()): RateLimitDetails {
  const number = (name: string) => {
    const raw = response?.headers?.get?.(name)
    if (raw === null || raw === undefined || String(raw).trim() === '') return undefined
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0 ? value : undefined
  }
  const rawRetry = response?.headers?.get?.('retry-after')
  const retrySeconds = number('retry-after')
  const retryDate = rawRetry && retrySeconds === undefined ? Date.parse(rawRetry) : NaN
  const retryMs = retrySeconds !== undefined ? Math.ceil(retrySeconds * 1000)
    : Number.isFinite(retryDate) ? Math.max(0, retryDate - now) : undefined
  const limit = number('x-ratelimit-limit'), remaining = number('x-ratelimit-remaining')
  const reset = number('x-ratelimit-reset')
  return {
    ...(retryMs === undefined ? {} : { retryAfterMs: retryMs }),
    ...(retrySeconds === undefined ? {} : { retryAfterSeconds: retrySeconds }),
    ...(limit === undefined ? {} : { rateLimitLimit: limit }),
    ...(remaining === undefined ? {} : { rateLimitRemaining: remaining }),
    ...(reset === undefined ? {} : { rateLimitResetSeconds: reset, rateLimitResetAt: now + Math.ceil(reset * 1000) })
  }
}

export function createUnipileRequestBudget(now = Date.now) {
  const cooldowns = new Map<string, { until: number; details: RateLimitDetails }>()
  const key = (base: string, path: string, method: string) => {
    const account = /^\/(acc_[^/?]+)\//.exec(path)?.[1]
    const route = path.split('?')[0].replace(/^\/acc_[^/]+/, '')
      .replace(/\/(users|posts|comments|relation-requests)\/[^/]+/g, '/$1/:id')
    return account ? `${base}:${account}:${method}:${route}` : undefined
  }
  return {
    before(base: string, path: string, method = 'GET') {
      const id = key(base, path, method)
      if (!id) return undefined
      const state = cooldowns.get(id)
      if (!state) return undefined
      if (state.until <= now()) { cooldowns.delete(id); return undefined }
      return { ...state.details, retryAfterMs: state.until - now(),
        rateLimitResetAt: state.until, requestSent: 0 }
    },
    observe(base: string, path: string, status: number, details: RateLimitDetails, method = 'GET') {
      const id = key(base, path, method)
      if (!id) return
      for (const [expired, state] of cooldowns) if (state.until <= now()) cooldowns.delete(expired)
      const until = Math.max(
        status === 429 ? now() + (details.retryAfterMs ?? 180_000) : 0,
        details.rateLimitRemaining === 0 ? details.rateLimitResetAt ?? 0 : 0)
      if (until > now() && until > (cooldowns.get(id)?.until ?? 0)) cooldowns.set(id, { until, details })
      // A successful cached/concurrent response must not erase another request's cooldown.
    }
  }
}
export const sharedUnipileRequestBudget = createUnipileRequestBudget()
