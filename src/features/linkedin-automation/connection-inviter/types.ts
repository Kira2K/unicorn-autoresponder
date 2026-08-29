import type { ConnectionSearchTemplate, SearchAudience } from './catalog.ts'

export type ConnectionRunStatus = 'running' | 'paused' | 'partial' | 'succeeded' | 'failed' |
  'uncertain' | 'stopped'

export type ConnectionRunStage = 'queued' | 'stack_required' | 'recovering' | 'verifying_account' |
  'waiting_gate' | 'searching' | 'search_cooldown' | 'sending' | 'invitation_delay' | 'waiting_retry' |
  'resolving_uncertain' | 'readback_pending' | 'search_exhausted' | 'completed' |
  'completed_shortfall' | 'completed_no_candidates' | 'stop_requested' | 'stopped_by_admin' |
  'paused_transient' | 'failed'

export type ConnectionHistoryStatus = 'discovered' | 'eligible' | 'sending' | 'deferred' |
  'sent' | 'pending' | 'accepted' | 'skipped' | 'failed' | 'uncertain'

export type ConnectionRetryState = {
  provider: 'noco' | 'unipile'
  operation: string
  attempt: number
  errorCode: string
  delayMs: number
  nextRetryAt: string
  firstFailedAt: string
  lastFailedAt: string
}

export type ConnectionTimerState = {
  kind: 'operation_gate_wait' | 'search_pacing' | 'search_batch_cooldown' | 'invitation_delay' |
    'overload_backoff'
  delayMs: number
  nextActionAt: string
}

export type ConnectionSearchProgress = {
  audience?: SearchAudience
  keyIndex: Record<SearchAudience, number>
  keyTotal: Record<SearchAudience, number>
  sourceKey?: string
  city?: string
  page: number
  nextCursor?: string
  found: number
  checked: number
  eligible: number
  skipped: number
  exhausted: Record<SearchAudience, boolean>
  pass: number
  pendingCandidates: ConnectionHistoryItem[]
}

export type ConnectionRunCounters = {
  searched: number
  discovered: number
  eligible: number
  sent: number
  skipped: number
  sentByAudience: Record<SearchAudience, number>
}

export type ConnectionRun = {
  runId: string
  runKey: string
  platformAccountId: number
  clientId: number
  clientName: string
  accountId: string
  stackId?: number
  stack?: string
  safeRecruiterOnly: boolean
  localDate: string
  weekKey: string
  status: ConnectionRunStatus
  stage: ConnectionRunStage
  connectionCount?: number
  dailyLimit?: number
  dailyQuota?: number
  audienceQuota: Record<SearchAudience, number>
  counters: ConnectionRunCounters
  usedSearchKeys: string[]
  seenPersonIds: string[]
  searchProgress: ConnectionSearchProgress
  skipReasonCounters: Record<string, number>
  retryState?: ConnectionRetryState
  timerState?: ConnectionTimerState
  nextActionAt?: string
  pausedAt?: string
  executorId?: string
  heartbeatAt?: string
  errorCode?: string
  createdAt: string
  updatedAt: string
  finishedAt?: string
  recordId?: number
}

export type ConnectionHistoryItem = {
  historyKey: string
  runId: string
  platformAccountId: number
  accountId: string
  personId: string
  audience: SearchAudience
  searchKey: string
  name: string
  headline: string
  location: string
  profileUrl?: string
  status: ConnectionHistoryStatus
  reasonCode?: string
  requestId?: string
  discoveredAt: string
  updatedAt: string
  sentAt?: string
  verifiedAt?: string
  recordId?: number
}

export type ConnectionAccountContext = {
  platformAccountId: number
  clientId: number
  clientName: string
  linkedinUrl: string
  accountId: string
  accountStatus?: string
  verifiedProviderId?: string
  lastVerifiedAt?: string
  stackId?: number
  stack?: string
}

export type ConnectionInviterStore = {
  listCatalog(): Promise<ConnectionSearchTemplate[]>
  listRuns(limit?: number): Promise<ConnectionRun[]>
  getRun(runId: string): Promise<ConnectionRun | undefined>
  getRunByKey(runKey: string): Promise<ConnectionRun | undefined>
  createRun(run: ConnectionRun): Promise<{ run: ConnectionRun; created: boolean }>
  updateRun(run: ConnectionRun): Promise<void>
  findHistory(accountId: string, personId: string): Promise<ConnectionHistoryItem | undefined>
  claimHistory(item: ConnectionHistoryItem): Promise<boolean>
  updateHistory(item: ConnectionHistoryItem): Promise<void>
  listHistory(platformAccountId: number, limit?: number): Promise<ConnectionHistoryItem[]>
}

export type ConnectionUnipileAdapter = {
  getAccount(accountId: string): Promise<any>
  getOwnProfile(accountId: string): Promise<any>
  getProfile(accountId: string, personId: string): Promise<any>
  listRelations?(accountId: string, cursor?: string): Promise<any>
  searchPeople(accountId: string, keywords: string, cursor?: string): Promise<any>
  listPendingInvitations(accountId: string, offset?: number): Promise<any>
  sendInvitation(accountId: string, personId: string): Promise<any>
}
