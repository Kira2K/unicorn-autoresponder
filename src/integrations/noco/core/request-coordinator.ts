type Loader<T> = () => Promise<T>

function copy<T>(value: T): T {
  return value === undefined ? value : structuredClone(value)
}

export function createNocoRequestCoordinator(options: {
  minIntervalMs?: number
  cacheTtlMs?: number
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
} = {}) {
  const minIntervalMs = options.minIntervalMs ?? 1_000
  const cacheTtlMs = options.cacheTtlMs ?? 15_000
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((milliseconds: number) =>
    new Promise(resolve => setTimeout(resolve, milliseconds)))
  const cache = new Map<string, { expiresAt: number; value: unknown }>()
  const inFlight = new Map<string, Promise<unknown>>()
  let tail = Promise.resolve()
  let lastStartedAt = 0
  let generation = 0

  function schedule<T>(loader: Loader<T>): Promise<T> {
    const queued = tail.then(async () => {
      const delay = Math.max(0, lastStartedAt + minIntervalMs - now())
      if (delay) await sleep(delay)
      lastStartedAt = now()
      return loader()
    })
    tail = queued.then(() => undefined, () => undefined)
    return queued
  }

  async function read<T>(key: string, loader: Loader<T>, ttlMs = cacheTtlMs): Promise<T> {
    const cached = cache.get(key)
    if (cached && cached.expiresAt > now()) return copy(cached.value as T)
    const pending = inFlight.get(key)
    if (pending) return copy(await pending as T)
    const startedGeneration = generation
    const request = loader().then(value => {
      if (ttlMs > 0 && generation === startedGeneration) {
        cache.set(key, { expiresAt: now() + ttlMs, value: copy(value) })
      }
      return value
    }).finally(() => inFlight.delete(key))
    inFlight.set(key, request)
    return copy(await request)
  }

  async function mutate<T>(loader: Loader<T>): Promise<T> {
    generation += 1
    cache.clear()
    const value = await loader()
    return value
  }

  return { mutate, read, schedule }
}

export const sharedNocoRequestCoordinator = createNocoRequestCoordinator()
