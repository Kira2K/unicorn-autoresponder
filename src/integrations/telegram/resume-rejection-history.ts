export type ResumeRejectionContext = { comment: string; returnedCvUrl: string }
type ResumeStage = 'draft' | 'en' | 'ru'
type RejectionEvent = {
  at: string
  fromStatus: string
  toStatus: string
  actor: string
  comment: string
  returnedCvUrl: string
}

function stageForStatus(status: string): ResumeStage | null {
  if (/^Draft in (process|approve by (Kira|student))$/.test(status)) return 'draft'
  if (/^English version in (progress|approve by (Kira|student))$/.test(status)) return 'en'
  if (/^Russian version in (process|approve by (Kira|student))$/.test(status)) return 'ru'
  return null
}

/** Append only: existing text events stay intact; new events retain the rejected URL. */
export function appendResumeRejectionHistory(previous: string, event: RejectionEvent): string {
  const stage = stageForStatus(event.fromStatus)
  if (!stage || stage !== stageForStatus(event.toStatus)) throw new Error('Invalid resume rejection stage')
  const line = JSON.stringify({
    version: 1, at: event.at, stage,
    transition: `${event.fromStatus} -> ${event.toStatus}`,
    actor: event.actor, comment: event.comment, returnedCvUrl: event.returnedCvUrl
  })
  return previous ? `${previous}${previous.endsWith('\n') ? '' : '\n'}${line}` : line
}

/** Read only the latest event: never recover an older URL for a newer return. */
export function activeResumeRejection(record: {
  status: string
  lastRejectionComment?: string
  rejectionHistory?: string
}): ResumeRejectionContext | null {
  const stage = stageForStatus(record.status.trim())
  const comment = (record.lastRejectionComment ?? '').trim()
  if (!stage || !comment) return null
  const withoutUrl = { comment, returnedCvUrl: '' }
  const lastLine = (record.rejectionHistory ?? '').trim().split(/\r?\n/).at(-1) ?? ''
  if (!lastLine.startsWith('{')) {
    const legacy = /^\d{4}-\d{2}-\d{2}T\S+ (.+?) -> (.+?)(?: by |: )/.exec(lastLine)
    const legacyStage = legacy ? stageForStatus(legacy[2]) : null
    return legacyStage && legacyStage !== stage ? null : withoutUrl
  }
  try {
    const event: unknown = JSON.parse(lastLine)
    if (!event || typeof event !== 'object' || Array.isArray(event)) return withoutUrl
    const saved = event as Record<string, unknown>
    if (saved.version !== 1 || !['draft', 'en', 'ru'].includes(String(saved.stage))) return withoutUrl
    if (saved.stage !== stage) return null
    if (saved.comment !== comment || typeof saved.returnedCvUrl !== 'string') return withoutUrl
    const url = saved.returnedCvUrl.trim()
    // Keep the original URL spelling (including query parameters), after validating its scheme.
    if (!url || !['http:', 'https:'].includes(new URL(url).protocol)) return withoutUrl
    return { comment, returnedCvUrl: url }
  } catch {
    return withoutUrl
  }
}
