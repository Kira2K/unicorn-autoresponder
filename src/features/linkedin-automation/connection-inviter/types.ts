import type { SearchAudience } from './catalog.ts'

export type ConnectionRunStatus = 'running' | 'paused' | 'succeeded' | 'failed' | 'uncertain'
export type ConnectionHistoryStatus = 'discovered' | 'eligible' | 'sending' | 'sent' | 'accepted' |
  'skipped' | 'failed' | 'uncertain'

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
  stage: string
  connectionCount?: number
  weeklyLimit?: number
  dailyQuota?: number
  audienceQuota: Record<SearchAudience, number>
  counters: { searched: number; discovered: number; eligible: number; sent: number; skipped: number }
  usedSearchKeys: string[]
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
