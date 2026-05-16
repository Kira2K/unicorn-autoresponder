const { isAutoResponderUrl } = require('../shared/hh-url.ts')
const {
  HH_AUTO_RESPONDER_LOGS_KEY,
  HH_AUTO_RESPONDER_PARSER_ERRORS_KEY
} = require('../orchestrator/config.ts')
const {
  isExecutionContextDestroyedError,
  waitForDomContentLoaded
} = require('../browser/page-utils.ts')
const { wait } = require('../orchestrator/runtime-utils.ts')

type ParserErrorEntry = import('../orchestrator/types.ts').ParserErrorEntry
type ParserLogEntry = import('../orchestrator/types.ts').ParserLogEntry

function extractParserErrorCodesFromLogs(
  parserLogs: ParserLogEntry[]
): string[] {
  const codes = new Set<string>()
  const knownCodePattern = /\b(?:ERROR_[A-Z0-9_]+|NO_[A-Z0-9_]+)\b/g

  for (const entry of parserLogs) {
    if (!entry.isError) {
      continue
    }

    const message = String(entry.message ?? '').toUpperCase()
    const matches = message.match(knownCodePattern)

    if (matches?.length) {
      for (const match of matches) {
        codes.add(match)
      }
    }
  }

  return [...codes]
}

async function getAutoResponderParserErrors(
  page: any
): Promise<ParserErrorEntry[]> {
  if (page.isClosed() || !isAutoResponderUrl(page.url())) {
    return []
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await waitForDomContentLoaded(page)

      return await page.evaluate((parserErrorsKey: string) => {
        try {
          const parsed = JSON.parse(
            sessionStorage.getItem(parserErrorsKey) || '[]'
          )

          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }, HH_AUTO_RESPONDER_PARSER_ERRORS_KEY)
    } catch (error: any) {
      if (!isExecutionContextDestroyedError(error)) {
        throw error
      }
    }

    await wait(500)
  }

  return []
}

async function getParserLogs(page: any): Promise<ParserLogEntry[]> {
  if (page.isClosed() || !isAutoResponderUrl(page.url())) {
    return []
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await waitForDomContentLoaded(page)

      return await page.evaluate((logsKey: string) => {
        try {
          const raw = sessionStorage.getItem(logsKey) || '[]'
          const parsed = JSON.parse(raw)

          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }, HH_AUTO_RESPONDER_LOGS_KEY)
    } catch (error: any) {
      if (!isExecutionContextDestroyedError(error)) {
        throw error
      }
    }

    await wait(500)
  }

  return []
}

module.exports = {
  extractParserErrorCodesFromLogs,
  getAutoResponderParserErrors,
  getParserLogs
}
