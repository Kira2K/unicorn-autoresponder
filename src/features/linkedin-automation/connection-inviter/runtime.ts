export type ConnectionRuntime = {
  store: any
  repository: any
  adapter(): any
  gate?: any
  now(): Date
  timeZone: string
  random(): number
  sleep(milliseconds: number): Promise<void>
  stopRequested(runId: string): boolean
  logger: import('./logger.ts').ConnectionLogger
}

export type SaveRun = (run: import('./types.ts').ConnectionRun) => Promise<void>
