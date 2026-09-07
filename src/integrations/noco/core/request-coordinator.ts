type Loader<T> = () => Promise<T>
type ReadOptions = number | { cacheTtlMs?: number; fresh?: boolean }

function copy<T>(value: T): T {
  return value === undefined ? value : structuredClone(value)
}

function createNocoRequestCoordinator(options: {
  cacheTtlMs?: number
  now?: () => number
} = {}) {
  const defaultCacheTtlMs = options.cacheTtlMs ?? 15_000
  const now = options.now ?? Date.now
  const cache = new Map<string, { expiresAt: number; value: unknown }>()
  const inFlight = new Map<string, { generation: number; request: Promise<unknown> }>()
  let generation = 0

  function readSettings(input?: ReadOptions) {
    if (typeof input === 'number') return { cacheTtlMs: input, fresh: false }
    return {
      cacheTtlMs: input?.cacheTtlMs ?? defaultCacheTtlMs,
      fresh: input?.fresh === true
    }
  }

  async function read<T>(key: string, loader: Loader<T>, input?: ReadOptions): Promise<T> {
    const settings = readSettings(input)
    if (settings.fresh) return copy(await loader())

    const cached = cache.get(key)
    if (cached && cached.expiresAt > now()) return copy(cached.value as T)
    if (cached) cache.delete(key)

    const pending = inFlight.get(key)
    if (pending?.generation === generation) return copy(await pending.request as T)

    const startedGeneration = generation
    const request = loader().then(value => {
      if (settings.cacheTtlMs > 0 && generation === startedGeneration) {
        cache.set(key, { expiresAt: now() + settings.cacheTtlMs, value: copy(value) })
      }
      return value
    }).finally(() => {
      if (inFlight.get(key)?.request === request) inFlight.delete(key)
    })
    inFlight.set(key, { generation: startedGeneration, request })
    return copy(await request)
  }

  function invalidate(): void {
    generation += 1
    cache.clear()
  }

  async function mutate<T>(loader: Loader<T>): Promise<T> {
    invalidate()
    return loader()
  }

  return { invalidate, mutate, read }
}

const sharedNocoRequestCoordinator = createNocoRequestCoordinator()

export { createNocoRequestCoordinator, sharedNocoRequestCoordinator }
export type { ReadOptions }
