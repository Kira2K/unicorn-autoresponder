import { createHash } from 'node:crypto'

type WorkflowState = {
  id: number
  clientId: number
  status: string
  studentDataFolderUrl?: string
  cvDraftUrl?: string
  enVersionUrl?: string
  ruVersionUrl?: string
  kirasComments?: string
  lastRejectionComment?: string
  rejectionHistory?: string
  workflowTrace?: string
}
/** Stable across restarts; a return changes the token even if the same URL is resubmitted. */
export function resumeWorkflowRevision(record: WorkflowState): string {
  const values = [record.id, record.clientId, record.status, record.studentDataFolderUrl,
    record.cvDraftUrl, record.enVersionUrl, record.ruVersionUrl, record.kirasComments,
    record.lastRejectionComment, record.rejectionHistory, record.workflowTrace]
    .map(value => String(value ?? '').trim())
  return createHash('sha256').update(JSON.stringify(values)).digest('base64url').slice(0, 16)
}

export function staleResumeWorkflowError() {
  return Object.assign(new Error('Задача или файл резюме изменились. Открой задачу заново через /open_my_tasks. Ученику: проверь актуальный файл через /resume_status и отправь /resume I approve для согласования.'),
    { code: 'resume_workflow_stale_revision' })
}
