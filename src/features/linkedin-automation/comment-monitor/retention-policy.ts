import type {MonitorJob} from './types.ts'

// Continuous sessions carry lifetime reply deduplication. Never purge that evidence or an unresolved send.
export function retainMonitorEvidence(job:MonitorJob) {
  return Boolean(job.state.automationKey) || job.state.items.some(item=>['publishing','uncertain'].includes(item.status))
}
