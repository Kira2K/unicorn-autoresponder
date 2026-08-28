export function connectionError(code: string, message: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) })
}

export function connectionErrorCode(error: unknown): string {
  const code = String((error as any)?.code ?? '')
  return /^(connection_|linkedin_|unipile_|noco_)/.test(code) ? code.slice(0, 120) :
    'connection_inviter_internal_error'
}
