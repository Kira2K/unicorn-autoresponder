export type ConnectionInviterService = {
  list(): Promise<Record<string, unknown>[]>
  get(runId: string): Promise<Record<string, unknown> | undefined>
  history(platformAccountId: number): Promise<Record<string, unknown>[]>
  readiness(platformAccountId: number): Promise<Record<string, unknown>>
  stacks(): Promise<Array<{ id: number; name: string }>>
  saveStack(platformAccountId: number, stackId: number): Promise<Record<string, unknown>>
  start(platformAccountId: number, input?: { safeRecruiterOnly?: boolean }):
    Promise<Record<string, unknown>>
  stop?(): void
}
