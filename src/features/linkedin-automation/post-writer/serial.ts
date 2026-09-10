export function createSerialQueue() {
  const tails = new Map<string, Promise<unknown>>()
  return function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const task = (tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(action)
    tails.set(key, task)
    void task.finally(() => { if (tails.get(key) === task) tails.delete(key) }).catch(() => undefined)
    return task
  }
}
