export type ProfileFillerService = {
  editField(jobId: string, hash: string, change: import('../../linkedin-automation/profile-filler/field-change.ts').FieldChange): Promise<Record<string, unknown>>
  recoverPending?(): Promise<void>
  startGeneration(platformAccountId: number,
    upload?: { bytes: Buffer; mimeType: string }): Promise<Record<string, unknown>>
  startPreview(platformAccountId: number, profileFile: unknown): Promise<Record<string, unknown>>
  apply(jobId: string, planHash: string): Promise<Record<string, unknown>>
  rollback(jobId: string): Promise<Record<string, unknown>>
  resume(jobId: string): Promise<Record<string, unknown>>
  stopGeneration(jobId: string): Promise<Record<string, unknown>>
  get(jobId: string): Promise<Record<string, unknown> | undefined>
  list(platformAccountId?: number): Promise<Record<string, unknown>[]>
  searchParameters(platformAccountId: number, type: string, keywords: string):
    Promise<Record<string, unknown>>
}
