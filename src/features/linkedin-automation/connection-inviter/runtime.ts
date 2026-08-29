import type { ConnectionLogger } from './logger.ts'
import type { ConnectionInviterStore, ConnectionRun, ConnectionUnipileAdapter } from './types.ts'

export type ConnectionRunEventType = 'snapshot' | 'stage_changed' | 'progress' | 'timer_started' |
  'retry_scheduled' | 'retry_succeeded' | 'invitation_sent' | 'paused' | 'stopped' |
  'partial' | 'completed' | 'uncertain'

export type ConnectionRuntime = {
  store: ConnectionInviterStore
  repository: {
    listAccounts(): Promise<any[]>
    listStacks(): Promise<Array<{ id: number; name: string }>>
    updatePrimaryStack(clientId: number, stackId: number): Promise<{ id: number; name: string }>
  }
  adapter(): ConnectionUnipileAdapter
  gate?: { acquire(operation: string, owner: string, accountKey?: string): (() => void) | undefined }
  now(): Date
  timeZone: string
  random(): number
  sleep(milliseconds: number): Promise<void>
  stopRequested(runId: string): boolean
  emit(run: ConnectionRun, type: ConnectionRunEventType): void
  logger: ConnectionLogger
  writerEnabled: boolean
  writerId: string
}

export type SaveRun = (run: ConnectionRun, event?: ConnectionRunEventType) => Promise<void>
