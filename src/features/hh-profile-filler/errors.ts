export class ProfileFillerError extends Error {
  readonly code: string
  readonly stage: string
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, stage = 'unknown', details?: Record<string, unknown>) {
    super(message)
    this.name = 'ProfileFillerError'
    this.code = code
    this.stage = stage
    this.details = details
  }
}

export function profileFillerError(code: string, message: string, stage: string,
  details?: Record<string, unknown>): ProfileFillerError {
  return new ProfileFillerError(code, message, stage, details)
}

export function errorCode(error: unknown): string {
  return error instanceof ProfileFillerError
    ? error.code
    : String((error as any)?.code ?? 'profile_filler_failed')
}

export function errorStage(error: unknown): string {
  return error instanceof ProfileFillerError ? error.stage : 'unknown'
}

export function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/password\s*[:=]\s*\S+/gi, 'password=[REDACTED]')
    .replace(/bearer\s+[\w.-]+/gi, 'Bearer [REDACTED]')
    .replace(/xc-token\s*[:=]\s*\S+/gi, 'xc-token=[REDACTED]')
}
