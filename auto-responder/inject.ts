const { isAutoResponderUrl } = require('../shared/hh-url.ts')
const {
  isExecutionContextDestroyedError,
  waitForDomContentLoaded
} = require('../browser/page-utils.ts')
const { recordVacancyTransition } = require('./counter.ts')

type ResponseCounter = import('../orchestrator/types.ts').ResponseCounter

function isWatcherNavigationRaceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)

  return (
    isExecutionContextDestroyedError(error) ||
    (message.includes('page.waitForSelector: Timeout') &&
      message.includes('#ar-main-panel')) ||
    (message.includes('page.waitForSelector: Timeout') &&
      message.includes('navigation to finish'))
  )
}

async function ensureIndexScript(
  page: any,
  indexScript: string,
  reason: string
): Promise<boolean> {
  if (page.isClosed() || !isAutoResponderUrl(page.url())) {
    return false
  }

  await waitForDomContentLoaded(page, 10000)

  const injectionState = await page.evaluate((source: string) => {
    if (document.getElementById('ar-main-panel')) {
      return 'already-present'
    }

    ;(0, eval)(source)
    document.documentElement.appendChild(
      document.createComment('hh-autoparcer-index-loaded')
    )

    return 'injected'
  }, indexScript)

  await page.waitForSelector('#ar-main-panel', {
    timeout: 10000
  })

  if (injectionState === 'injected') {
    console.log(`index.js injected after ${reason}: ${page.url()}`)
  }

  return true
}

async function removeAutoResponderUi(page: any): Promise<void> {
  if (page.isClosed()) {
    return
  }

  await page.evaluate(() => {
    document.getElementById('ar-main-panel')?.remove()
  }).catch(() => undefined)
}

function installIndexReinjectWatcher(
  page: any,
  indexScript: string,
  responseCounter: ResponseCounter
): () => void {
  let disposed = false
  let queue = Promise.resolve()

  const scheduleInject = (reason: string) => {
    if (disposed || page.isClosed()) {
      return
    }

    recordVacancyTransition(responseCounter, page.url())

    queue = queue
      .then(async () => {
        await ensureIndexScript(page, indexScript, reason)
      })
      .catch((error: unknown) => {
        if (!disposed && !isWatcherNavigationRaceError(error)) {
          console.error(error instanceof Error ? error.message : error)
        }
      })
  }

  const onFrameNavigated = (frame: any) => {
    if (frame === page.mainFrame()) {
      recordVacancyTransition(responseCounter, frame.url())
      scheduleInject('navigation')
    }
  }
  const onDomContentLoaded = () => {
    recordVacancyTransition(responseCounter, page.url())
    scheduleInject('domcontentloaded')
  }

  page.on('framenavigated', onFrameNavigated)
  page.on('domcontentloaded', onDomContentLoaded)

  return () => {
    disposed = true
    page.off('framenavigated', onFrameNavigated)
    page.off('domcontentloaded', onDomContentLoaded)
  }
}

module.exports = {
  ensureIndexScript,
  installIndexReinjectWatcher,
  removeAutoResponderUi
}
