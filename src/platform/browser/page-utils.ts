type BrowserPageLike = {
  waitForLoadState(
    state?: string,
    options?: Record<string, unknown>
  ): Promise<unknown>
  close?(): Promise<unknown>
}

function isExecutionContextDestroyedError(error: unknown): boolean {
  return String((error as any)?.message ?? error).includes(
    'Execution context was destroyed'
  )
}

function isPageClosedError(error: unknown): boolean {
  return /Target page, context or browser has been closed|Target closed|Page closed|Context closed|Browser has been closed/i.test(
    String((error as any)?.message ?? error)
  )
}

async function waitForDomContentLoaded(
  page: BrowserPageLike,
  timeout = 5000
): Promise<void> {
  await page
    .waitForLoadState('domcontentloaded', {
      timeout
    })
    .catch(() => undefined)
}

async function closePageQuietly(page: BrowserPageLike | undefined): Promise<void> {
  await page?.close?.().catch(() => undefined)
}

module.exports = {
  closePageQuietly,
  isExecutionContextDestroyedError,
  isPageClosedError,
  waitForDomContentLoaded
}
