import { publicRun } from './run-model.ts'
import type { ConnectionRunEventType } from './runtime.ts'
import type { ConnectionRun } from './types.ts'

export type ConnectionRunEvent = {
  id: number
  type: ConnectionRunEventType
  at: string
  run: ReturnType<typeof publicRun>
}

export function createConnectionRunEvents() {
  const listeners = new Map<string, Set<(event: ConnectionRunEvent) => void>>()
  const fingerprints = new Map<string, string>()
  let sequence = 0
  return {
    emit(run: ConnectionRun, type: ConnectionRunEventType) {
      const safeRun = publicRun(run)
      const comparable = { ...safeRun, updatedAt: undefined, heartbeatAt: undefined }
      const fingerprint = JSON.stringify(comparable)
      if (type !== 'snapshot' && fingerprints.get(run.runId) === fingerprint) return
      fingerprints.set(run.runId, fingerprint)
      const event: ConnectionRunEvent = { id: ++sequence, type, at: new Date().toISOString(), run: safeRun }
      for (const listener of listeners.get(run.runId) ?? []) listener(event)
    },
    subscribe(runId: string, listener: (event: ConnectionRunEvent) => void) {
      const bucket = listeners.get(runId) ?? new Set()
      bucket.add(listener); listeners.set(runId, bucket)
      return () => {
        bucket.delete(listener)
        if (!bucket.size) listeners.delete(runId)
      }
    },
    clear() { listeners.clear(); fingerprints.clear() }
  }
}
