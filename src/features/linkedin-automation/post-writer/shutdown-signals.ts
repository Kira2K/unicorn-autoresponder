import type { Log } from './types.ts'
import { errorCode } from './errors.ts'
export function registerWriterShutdown(close: () => Promise<void>, log: Log) {
  let pending = false
  const stop = () => {
    if (pending) return
    pending = true
    void close().then(() => process.exit(0)).catch(error => {
      log('shutdown_blocked', { code: errorCode(error) })
    })
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  return () => {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}
