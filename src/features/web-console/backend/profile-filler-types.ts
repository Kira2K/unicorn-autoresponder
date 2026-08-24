export type ProfileFillerService = {
  startPreview(platformAccountId: number, profileFile: unknown): Promise<Record<string, unknown>>
  apply(jobId: string, planHash: string): Promise<Record<string, unknown>>
  rollback(jobId: string): Promise<Record<string, unknown>>
  get(jobId: string): Promise<Record<string, unknown> | undefined>
  list(): Promise<Record<string, unknown>[]>
  searchParameters(platformAccountId: number, type: string, keywords: string):
    Promise<Record<string, unknown>>
}
