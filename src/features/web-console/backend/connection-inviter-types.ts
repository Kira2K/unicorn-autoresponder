export type ConnectionInviterService = {
  settings(): { writerEnabled: boolean } | Promise<{ writerEnabled: boolean }>
  list(): Promise<Record<string, unknown>[]>
  get(runId: string): Promise<Record<string, unknown> | undefined>
  history(platformAccountId: number): Promise<Record<string, unknown>[]>
  readiness(platformAccountId: number): Promise<Record<string, unknown>>
  stacks(): Promise<Array<{ id: number; name: string }>>
  saveStack(platformAccountId: number, stackId: number): Promise<Record<string, unknown>>
  start(platformAccountId: number, input?: { safeRecruiterOnly?: boolean }):
    Promise<Record<string, unknown>>
  stopRun(runId: string): Promise<Record<string, unknown>>
  subscribe?(runId: string, listener: (event: { id: number; type: string; at: string;
    run: Record<string, unknown> }) => void): () => void
  recover?(): Promise<void>
  stop?(): void
}
