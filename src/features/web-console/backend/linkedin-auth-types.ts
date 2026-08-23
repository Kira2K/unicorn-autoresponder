export type LinkedInAuthAction = 'check' | 'connect' | 'force_reauth'
export type LinkedInAuthRunStatus = 'running' | 'succeeded' | 'failed'

export type LinkedInAuthRun = {
  runId: string
  platformAccountId: number
  clientName: string
  action: LinkedInAuthAction
  status: LinkedInAuthRunStatus
  stage: string
  stageStatus: 'started' | 'succeeded' | 'failed'
  startedAt: string
  updatedAt: string
  finishedAt?: string
  result?: Record<string, unknown>
  error?: import('../../linkedin-automation/account-connection/error-display.ts').ErrorDisplay
}

export type LinkedInAuthRunService = {
  listAccounts(): Promise<Record<string, unknown>[]>
  listHistory(): Promise<Record<string, unknown>[]>
  updateAccount(platformAccountId: number, input: { linkedinUrl: unknown }): Promise<Record<string, unknown>>
  start(platformAccountId: number, action: LinkedInAuthAction): Promise<LinkedInAuthRun>
  get(runId: string): LinkedInAuthRun | undefined
}
