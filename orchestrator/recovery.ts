const { classifyClientRun } = require('./scraper-state.ts') as {
  classifyClientRun(status: OrchestratorStatus): string
}

type HhAuthState = import('./types.ts').HhAuthState
type OrchestratorStatus = import('./types.ts').OrchestratorStatus

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '')
}

function isCaptchaText(value: string): boolean {
  return /captcha|капч/i.test(value)
}

function isBrowserDisconnectedText(value: string): boolean {
  return (
    value.includes('Browser CDP connection was closed') ||
    value.includes('Page was closed while auto responder was running')
  )
}

function shouldRefuseAuthReload(status: OrchestratorStatus): boolean {
  const authStates: Array<HhAuthState | undefined> = [
    status.authBeforeStart?.state,
    status.authAfterParserStop?.state
  ]

  return authStates.includes('logged_out') && status.authAfterParserStop?.state !== 'logged_in'
}

function getAutoReloadRecoveryReason(input: {
  status: OrchestratorStatus
  error?: unknown
}): string | undefined {
  const { status, error } = input

  if (status.autoReloadRecoveryAttempted) {
    return undefined
  }

  const errorMessage = error ? messageOf(error) : status.error ?? ''

  if (isCaptchaText(errorMessage) || classifyClientRun(status) === 'captcha_detected') {
    return undefined
  }

  if (isBrowserDisconnectedText(errorMessage) || classifyClientRun(status) === 'browser_disconnected') {
    return undefined
  }

  if (errorMessage.includes('HH login form did not open')) {
    return undefined
  }

  if (errorMessage.includes('page.goto: Timeout')) {
    return 'navigation_timeout'
  }

  if (
    errorMessage.includes('page.waitForSelector: Timeout') &&
    (errorMessage.includes('#ar-main-panel') || errorMessage.includes('#ar-start-btn'))
  ) {
    return 'start_ui_selector_timeout'
  }

  if (shouldRefuseAuthReload(status)) {
    return undefined
  }

  const parserCodes = status.parserErrorCodes ?? []

  if (
    (status.autoResponderStopReason === 'auth_required' || parserCodes.includes('AUTH_REQUIRED')) &&
    status.authAfterParserStop?.state === 'logged_in'
  ) {
    return 'auth_required_after_logged_in'
  }

  if (
    status.autoResponderWatchTimedOut &&
    status.autoResponderFinished === false &&
    !status.autoResponderStopReason &&
    parserCodes.length === 0
  ) {
    return 'no_reason_watch_timeout'
  }

  return undefined
}

module.exports = {
  getAutoReloadRecoveryReason
}
