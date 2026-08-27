type Sleep = (milliseconds: number) => Promise<void>

export function createUnipileRequestScheduler(options: {
  minIntervalMs?: number
  now?: () => number
  sleep?: Sleep
} = {}) {
  const minIntervalMs = options.minIntervalMs ?? 5_000
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((milliseconds: number) =>
    new Promise(resolve => setTimeout(resolve, milliseconds)))
  let tail = Promise.resolve()
  let lastStartedAt = 0

  function run<T>(operation: () => Promise<T>) {
    const queued = tail.then(async () => {
      const waitMs = Math.max(0, lastStartedAt + minIntervalMs - now())
      if (waitMs) await sleep(waitMs)
      lastStartedAt = now()
      return operation()
    })
    tail = queued.then(() => undefined, () => undefined)
    return queued
  }
  return { run }
}
