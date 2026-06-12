function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function getErrorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function timeoutError(message: string): Error {
  const error = new Error(message) as Error & { code?: string }
  error.code = 'timeout'

  return error
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => Promise<void>
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(async () => {
          try {
            await onTimeout?.()
          } catch {
            // Preserve the original timeout reason.
          }

          reject(timeoutError(message))
        }, timeoutMs)
      })
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

module.exports = {
  getErrorMessage,
  getErrorStack,
  wait,
  withTimeout
}
