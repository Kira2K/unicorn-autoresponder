import { PostError } from './errors.ts'
export function createWorkTracker() {
  const tasks = new Set<Promise<unknown>>()
  let closing = false
  return {
    isClosing: () => closing,
    run<T>(action: () => Promise<T>): Promise<T> {
      if (closing) return Promise.reject(new PostError('post_writer_closing'))
      const task = Promise.resolve().then(action)
      tasks.add(task)
      void task.finally(() => tasks.delete(task)).catch(() => undefined)
      return task
    },
    async drain() {
      closing = true
      while (tasks.size) await Promise.allSettled([...tasks])
    }
  }
}
