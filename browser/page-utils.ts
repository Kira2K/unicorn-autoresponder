function isExecutionContextDestroyedError(error: unknown): boolean {
  return String((error as any)?.message ?? error).includes(
    'Execution context was destroyed'
  )
}

async function waitForDomContentLoaded(
  page: any,
  timeout = 5000
): Promise<void> {
  await page
    .waitForLoadState('domcontentloaded', {
      timeout
    })
    .catch(() => undefined)
}

async function closePageQuietly(page: any): Promise<void> {
  await page?.close?.().catch(() => undefined)
}

module.exports = {
  closePageQuietly,
  isExecutionContextDestroyedError,
  waitForDomContentLoaded
}
