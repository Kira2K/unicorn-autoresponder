export type CommentMonitorService = {
  ensureAutomatic?(platformAccountId:number,key:string,publication?:import('../../linkedin-automation/comment-monitor/types.ts').TrackedPost):Promise<Record<string,unknown>>
  enable(platformAccountId: number): Promise<Record<string, unknown>>
  disable(platformAccountId: number): Promise<Record<string, unknown> | undefined>
  resume(jobId: string): Promise<Record<string, unknown>>
  get(jobId: string): Promise<Record<string, unknown> | undefined>
  list(): Promise<Record<string, unknown>[]>
  stop?(): void
}
