export type CommentMonitorService = {
  enable(platformAccountId: number): Promise<Record<string, unknown>>
  disable(platformAccountId: number): Promise<Record<string, unknown> | undefined>
  resume(jobId: string): Promise<Record<string, unknown>>
  get(jobId: string): Promise<Record<string, unknown> | undefined>
  list(): Promise<Record<string, unknown>[]>
  stop?(): void
}
