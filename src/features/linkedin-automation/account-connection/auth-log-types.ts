export type AuthLogStatus = 'started' | 'succeeded' | 'failed'

export type AuthLogDetails = {
  mode?: 'dry-run' | 'apply' | 'force-reauth'
  clientId?: number
  platformAccountId?: number
  dolphinProfileId?: number
  durationMs?: number
  existingAccount?: boolean
  dolphinProtocol?: 'http' | 'https' | 'socks4' | 'socks5'
  unipileProtocol?: 'http' | 'https' | 'socks4' | 'socks5'
  authenticated?: boolean
  cookiePresent?: boolean
  userAgentPresent?: boolean
  ownerMatched?: boolean
  errorCode?: string
}

export type AuthLogRecord = AuthLogDetails & {
  at: string
  runId: string
  stage: string
  status: AuthLogStatus
}

export type AuthLogger = {
  event(stage: string, status: AuthLogStatus, details?: AuthLogDetails): void
  run<T>(stage: string, details: AuthLogDetails, action: () => Promise<T>): Promise<T>
}
