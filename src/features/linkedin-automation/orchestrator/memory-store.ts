import { automationError, type AutomationStore, type AutomationSettings, type AutomationRun, type AuditEvent, type WorkerHeartbeat } from './contracts.ts'
// Test/demo adapter only. Production composition must supply SQL explicitly.
export function createMemoryAutomationStore(): AutomationStore {
  const settings = new Map<number, AutomationSettings>(), runs = new Map<string, AutomationRun>()
  const copy = structuredClone
  const journal: AuditEvent[] = []
  let heartbeat: WorkerHeartbeat | undefined
  const append = (event: AuditEvent) => { journal.push(copy({ ...event, id: journal.length + 1 })) }
  return {
    settings: async () => copy([...settings.values()]),
    async saveSettings(value, expected, event) {
      if ((settings.get(value.account)?.revision ?? 0) !== expected) throw automationError('automation_settings_conflict')
      settings.set(value.account, copy(value));if(event)append(event); return copy(value)
    },
    runs: async account => copy([...runs.values()].filter(r => account === undefined || r.account === account)
      .sort((a, b) => b.updatedAt - a.updatedAt)),
    async claim(value) { if (!runs.has(value.key)) runs.set(value.key, copy(value)); return copy(runs.get(value.key)!) },
    async saveRun(value, event) { if (!runs.has(value.key)) throw automationError('automation_run_missing'); runs.set(value.key, copy(value)); if (event) append(event) },
    async appendEvent(event) { append(event) },
    events: async q => copy(journal.filter(e => (q.account === undefined || e.account === q.account) &&
      (q.runKey === undefined || e.runKey === q.runKey) && (q.before === undefined || e.id! < q.before))
      .reverse().slice(0, Math.min(q.limit ?? 100, 500))),
    async heartbeat(value) { if (value) heartbeat = copy(value); return copy(heartbeat) }
  }
}
