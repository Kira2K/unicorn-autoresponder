import type { applicationStatus } from './status.ts'

type Status = ReturnType<typeof applicationStatus>

/** One target's navigation packet. Details remain in SQL/files; this never authorizes writes. */
export function applicationWorkerPacket(status: Status, inputPath: string, positionId?: string) {
  if (!positionId && status.targets.length !== 1) throw Error('worker_packet_requires_one_position')
  const target = status.targets.find(t => t.id === (positionId ?? status.targets[0]?.id))
  if (!target) throw Error('worker_packet_position_outside_batch')
  return {
    version: 1,
    candidateId: status.candidateId, batchId: status.batchId, cvMode: status.cvMode,
    target: {
      id: target.id, status: target.status, reason: target.reason, attempt: target.attempt, next: target.next,
      engine: target.engine, formSignature: target.formSignature, cachedQuestions: target.cachedQuestions,
      missingQuestionCount: target.missingQuestions.length,
      publication: target.publication ? { status: target.publication.status, date: target.publication.context.publicationDate, ageDays: target.publication.context.ageDays } : undefined,
    },
    rules: { status: status.rules.status, currentHash: status.rules.currentHash },
    references: { inputPath, runbook: 'src/features/external-responses/application_workflow/RUNBOOK.md' },
    operatingRules: [
      'Advisory SQL checkpoint, not permission to submit. Keep frozen scope, budget and all live gates.',
      'Use one fresh worker without inherited chat/development history. Keep the existing browser owner/process.',
      'Read exact missing questions/options from application-status --position ID only if needed; do not guess.',
      'Use the retained process status/verify/resume controls. Do not create another CDP owner or repeat submission.',
      'Read only evidence needed for next action. Busy means deferred; unknown means reconcile. Never open LinkedIn.',
    ],
  }
}
