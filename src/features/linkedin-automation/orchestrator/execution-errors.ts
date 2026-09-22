// A temporary execution boundary closes writes but must not turn resumable work into a terminal feature error.
export function isAutomationPause(code:string) {
  return ['automation_worker_stopping','automation_writer_unavailable','automation_writer_active',
    'automation_audit_unavailable','automation_preview_only','automation_comments_inactive_day',
    'automation_comments_waiting_for_post','automation_comments_yielding'].includes(code)
}
