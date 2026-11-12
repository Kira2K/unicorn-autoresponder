function createResponseDeadline(timeoutMs: number, now: () => number = Date.now) {
  let maximum = 0, lastIncrease = now()
  return {
    observe(count: number): boolean {
      if (Number.isFinite(count) && count > maximum) {
        maximum = count
        lastIncrease = now()
      }
      return timeoutMs > 0 && now() - lastIncrease >= timeoutMs
    }
  }
}
module.exports = { createResponseDeadline }
