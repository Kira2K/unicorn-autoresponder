export type MonitorStatus = 'starting' | 'waiting' | 'checking' | 'replying' |
  'paused' | 'completed' | 'disabled' | 'error'

export type TrackedPost = {
  id: string
  url?: string
  createdAt?: string
  text: string
}

export type MonitorItem = {
  recovery?: import('../action-recovery.ts').ActionRecovery
  incomingId: string
  postId: string
  threadId: string
  parentId: string
  incomingText: string
  threadText: string
  replyText?: string
  replyId?: string
  attemptedAt?: string
  uncertainSince?: string
  verificationStopped?: boolean
  /** Archived stopped intent carried into a later session, never sendable again. */
  quotaReleased?: boolean
  quotaUntil?: string
  nextVerificationAt?: string
  verificationChecks?: number
  status: 'detected' | 'generating' | 'queued' | 'publishing' |
    'verified' | 'ignored' | 'failed' | 'uncertain'
  reasonCode?: string
  createdAt: string
  updatedAt: string
}

export type MonitorState = {
  readRecovery?: Record<string, import('../action-recovery.ts').ActionRecovery>
  nextWorkAt?: string
  providerNotBefore?: string
  verificationSources?: string[]
  automationId?: string
  postsCheckedForPublication?: number
  posts: TrackedPost[]
  items: MonitorItem[]
  knownIds: string[]
  checks: number
  discovered: number
  published: number
  failed: number
  threadReplies: Record<string, number>
  checkedThreads?: Record<string, { count: number; text: string; at: number }>
}

export type MonitorJob = {
  recordId?: number
  jobId: string
  platformAccountId: number
  accountId: string
  clientName: string
  status: MonitorStatus
  stage: string
  state: MonitorState
  nextCheckAt?: string
  lastCheckAt?: string
  expiresAt: string
  errorCode?: string
  createdAt: string
  updatedAt: string
  finishedAt?: string
  authorHeadline?: string
  authorAbout?: string
  authorContextFetchedAt?: string
  authorContextStatus?: 'ready' | 'empty' | 'failed'
}

export type CommentLogger = {
  event(stage: string, status: 'started' | 'succeeded' | 'failed', details?: Record<string, unknown>): void
}

export const activeStatus = (status: MonitorStatus) =>
  ['starting', 'waiting', 'checking', 'replying', 'paused'].includes(status)

export const publicMonitorJob = (job: MonitorJob) => {
  const { authorHeadline: _headline, authorAbout: _about,
    authorContextFetchedAt: _fetchedAt, authorContextStatus: _status,
    ...safe } = structuredClone(job)
  return safe
}
