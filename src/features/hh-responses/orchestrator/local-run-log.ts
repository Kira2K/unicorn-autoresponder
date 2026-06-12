const fsSync = require('node:fs')

const {
  LOCAL_RUN_ID,
  LOCAL_RUN_LOG_DIR,
  LOCAL_RUN_LOG_FILE
} = require('./config.ts')
const { getErrorMessage } = require('./runtime-utils.ts')

type LocalRunLogRecord = import('./types.ts').LocalRunLogRecord

function writeLocalRunLog(record: LocalRunLogRecord): void {
  try {
    fsSync.mkdirSync(LOCAL_RUN_LOG_DIR, {
      recursive: true
    })
    fsSync.appendFileSync(
      LOCAL_RUN_LOG_FILE,
      `${JSON.stringify({
        runId: LOCAL_RUN_ID,
        at: new Date().toISOString(),
        pid: process.pid,
        ...record
      })}\n`,
      'utf8'
    )
  } catch (error: unknown) {
    console.error(`Failed to write local run log: ${getErrorMessage(error)}`)
  }
}

module.exports = {
  writeLocalRunLog
}
