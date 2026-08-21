const { getAuthErrorCode } = require('../../linkedin-automation/account-connection/errors.ts') as {
  getAuthErrorCode(error: unknown): string
}
const { linkedinAuthErrorDisplay } = require('../../linkedin-automation/account-connection/error-display.ts') as {
  linkedinAuthErrorDisplay(code: unknown): any
}

function safeResult(result: any): Record<string, unknown> {
  return {
    mode: String(result?.mode ?? ''),
    ...(result?.accountId ? { accountId: String(result.accountId) } : {}),
    ...(result?.accountStatus ? { accountStatus: String(result.accountStatus) } : {})
  }
}

function executeLinkedInAuthRun(options: any) {
  const { account, action, execute, history, repository, run, update, onDone } = options
  const startedWrite = history.start(run).then(() => true).catch(() => false)
  void execute(account, action, (event: any) => update(run, {
    stage: event.stage, stageStatus: event.status
  }), repository).then((result: any) => update(run, {
    status: 'succeeded', stage: 'completed', stageStatus: 'succeeded',
    finishedAt: new Date().toISOString(), result: safeResult(result)
  })).catch((error: unknown) => {
    const code = getAuthErrorCode(error)
    update(run, {
      status: 'failed', stageStatus: 'failed', finishedAt: new Date().toISOString(),
      error: linkedinAuthErrorDisplay(code)
    })
  }).finally(async () => {
    onDone()
    if (await startedWrite) await history.finish(run).catch(() => undefined)
  })
}

module.exports = { executeLinkedInAuthRun, safeResult }
