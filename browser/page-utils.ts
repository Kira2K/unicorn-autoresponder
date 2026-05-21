type BrowserPageLike = import('../orchestrator/types.ts').BrowserPageLike

function isExecutionContextDestroyedError(error: unknown): boolean {
  return String((error as any)?.message ?? error).includes(
    'Execution context was destroyed'
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
  waitForDomContentLoaded
}
