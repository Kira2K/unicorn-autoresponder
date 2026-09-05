const batchAssert: typeof import('node:assert/strict') = require('node:assert/strict')
const { createNocoRequestLimiter: createBatchLimiter } = require('./request-limiter.ts') as {
  createNocoRequestLimiter(options: import('./request-limiter.ts').LimiterOptions): {
    schedule<T>(kind: 'read' | 'write', action: () => Promise<T>): Promise<T>
  }
}

async function testCompletedBatches() {
  for (const retryAfter of [0.025, 5, undefined]) {
    let clock = 0
    let active = 0
    let peak = 0
    const starts: number[] = []
    const finishes: number[] = []
    const limiter = createBatchLimiter({ now: () => clock, log() {},
      sleep: async milliseconds => { clock += milliseconds } })
    const results = await Promise.allSettled(Array.from({ length: 13 }, (_, index) =>
      limiter.schedule('read', async () => {
        starts[index] = clock
        peak = Math.max(peak, ++active)
        try {
          if (index === 3) {
            clock += 1_500
            throw Object.assign(new Error('mock overload'), { response: {
              status: 429, headers: retryAfter === undefined ? {} : { 'retry-after': String(retryAfter) }
            } })
          }
          if (index === 7) throw new Error('mock request failure')
        } finally { finishes[index] = clock; active -= 1 }
      })))
    batchAssert.equal(peak, 1)
    batchAssert.equal(results[3].status, 'rejected')
    batchAssert.equal(results[7].status, 'rejected')
    const cooldown = retryAfter === undefined ? 30_000 : retryAfter * 1000
    batchAssert.ok(starts[4] - finishes[3] >= Math.max(1000, cooldown),
      'A short Retry-After must not cancel the fourth completed request pause')
    for (const index of [8, 12]) {
      batchAssert.ok(starts[index] - finishes[index - 1] >= 1000,
        'Failed attempts count; the queue must not burst after a cooldown')
    }
  }
}

module.exports = { testCompletedBatches }
