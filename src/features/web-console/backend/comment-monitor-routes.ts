type App = import('express').Express
type Handler = import('express').RequestHandler
type Service = import('./comment-monitor-types.ts').CommentMonitorService
import { nocoRouteFailure } from './noco-route-failure.ts'

function failure(error: any) {
  const nocoFailure = nocoRouteFailure(error)
  if (nocoFailure) return nocoFailure
  const code = String(error?.code ?? 'comment_monitor_internal_error')
  if (code === 'comment_monitor_job_not_found') return { status: 404,
    body: { error: code, message: 'Comment monitor was not found.' } }
  if (['linkedin_account_not_found', 'comment_monitor_posts_missing'].includes(code)) {
    return { status: 404, body: { error: code, message: code === 'comment_monitor_posts_missing'
      ? 'No LinkedIn posts were found.' : 'LinkedIn account was not found.' } }
  }
  if (['comment_monitor_auth_required', 'comment_monitor_user_id_missing',
    'comment_monitor_resume_invalid', 'linkedin_operation_active'].includes(code)) {
    return { status: 409, body: { error: code,
      message: code === 'comment_monitor_auth_required' ? 'Verify LinkedIn before enabling replies.'
        : 'Comment monitoring cannot start in the current state.' } }
  }
  if (code === 'comment_monitor_table_missing') return { status: 503,
    body: { error: code, message: 'Run the LinkedIn comment monitor Noco migration.' } }
  return { status: 500, body: { error: 'comment_monitor_internal_error',
    message: 'LinkedIn comment monitoring failed.' } }
}

export function registerCommentMonitorRoutes(options: {
  app: App; requireAdmin: Handler; service: Service
}) {
  const { app, requireAdmin, service } = options
  app.get('/api/admin/linkedin/comment-monitors', requireAdmin, async (_req, res) => {
    try { res.json({ jobs: await service.list() }) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.get('/api/admin/linkedin/comment-monitors/:jobId', requireAdmin, async (req, res) => {
    try {
      const job = await service.get(String(req.params.jobId))
      if (!job) { res.status(404).json({ error: 'comment_monitor_job_not_found' }); return }
      res.json(job)
    } catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.put('/api/admin/linkedin/accounts/:id/comment-monitor', requireAdmin, async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0 || typeof req.body?.enabled !== 'boolean') {
      res.status(400).json({ error: 'comment_monitor_request_invalid' }); return
    }
    try {
      const job = req.body.enabled ? await service.enable(id) : await service.disable(id)
      res.status(req.body.enabled ? 202 : 200).json(job ?? { platformAccountId: id,
        status: 'disabled', stage: 'not_enabled' })
    } catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.post('/api/admin/linkedin/comment-monitors/:jobId/resume', requireAdmin, async (req, res) => {
    try { res.status(202).json(await service.resume(String(req.params.jobId))) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
}
