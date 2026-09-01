type App = import('express').Express
type Handler = import('express').RequestHandler
type Service = import('./connection-inviter-types.ts').ConnectionInviterService
import { nocoRouteFailure } from './noco-route-failure.ts'

function failure(error: any) {
  const nocoFailure = nocoRouteFailure(error)
  if (nocoFailure) return nocoFailure
  const code = String(error?.code ?? 'connection_inviter_internal_error')
  if (['linkedin_account_not_found', 'connection_run_not_found'].includes(code)) return {
    status: 404, body: { error: code, message: 'LinkedIn account or connection run was not found.' }
  }
  if (['connection_inviter_tables_missing',
    'connection_inviter_unique_constraints_missing'].includes(code)) return { status: 503,
    body: { error: code, message: 'Run the Connection Inviter NocoDB migration.' } }
  if (['connection_inviter_auth_required', 'connection_count_unavailable',
    'connection_uncertain_requires_review', 'connection_invitation_result_pending',
    'linkedin_operation_active', 'connection_run_retry_blocked', 'connection_writer_disabled',
    'connection_writer_active', 'connection_writer_id_missing',
    'connection_writer_identity_mismatch',
    'noco_stack_not_found', 'noco_stack_relation_missing',
    'noco_stack_update_failed'].includes(code)) return { status: 409,
    body: { error: code, message: error?.message || 'Connection Inviter cannot start.' } }
  return { status: 500, body: { error: 'connection_inviter_internal_error',
    message: 'Connection Inviter failed.' } }
}

function accountId(value: unknown): number | undefined {
  const id = Number(value); return Number.isInteger(id) && id > 0 ? id : undefined
}

export function registerConnectionInviterRoutes(options: {
  app: App; requireAdmin: Handler; service: Service
}) {
  const { app, requireAdmin, service } = options
  app.get('/api/admin/linkedin/connection-settings', requireAdmin, async (_req, res) => {
    try { res.json(await service.settings()) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.get('/api/admin/linkedin/connection-runs', requireAdmin, async (_req, res) => {
    try { res.json({ runs: await service.list() }) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.get('/api/admin/linkedin/connection-runs/:runId', requireAdmin, async (req, res) => {
    try {
      const run = await service.get(String(req.params.runId))
      if (!run) { res.status(404).json({ error: 'connection_run_not_found' }); return }
      res.json(run)
    } catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.get('/api/admin/linkedin/connection-runs/:runId/events', requireAdmin, async (req, res) => {
    let unsubscribe: () => void = () => undefined
    let keepalive: ReturnType<typeof setInterval> | undefined
    const cleanup = () => {
      if (keepalive) clearInterval(keepalive)
      unsubscribe()
    }
    try {
      const runId = String(req.params.runId)
      const run = await service.get(runId)
      if (!run) { res.status(404).json({ error: 'connection_run_not_found' }); return }
      res.status(200)
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders?.()
      const send = (type: string, data: unknown, id?: number) => {
        if (id !== undefined) res.write(`id: ${id}\n`)
        res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
      }
      unsubscribe = service.subscribe?.(runId, event => send(event.type, event, event.id)) ??
        (() => undefined)
      // Subscribe before the authoritative snapshot so a terminal transition cannot be lost
      // between the initial existence check and opening the event stream.
      const authoritative = await service.get(runId) ?? run
      send('snapshot', { type: 'snapshot', run: authoritative })
      keepalive = setInterval(() => res.write(': keepalive\n\n'), 15_000)
      keepalive.unref?.()
      req.once('close', cleanup)
    } catch (error) {
      cleanup()
      if (res.headersSent) { res.end(); return }
      const result = failure(error); res.status(result.status).json(result.body)
    }
  })
  app.post('/api/admin/linkedin/connection-runs/:runId/stop', requireAdmin, async (req, res) => {
    try { res.status(202).json(await service.stopRun(String(req.params.runId))) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.get('/api/admin/linkedin/connection-stacks', requireAdmin, async (_req, res) => {
    try { res.json({ stacks: await service.stacks() }) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.get('/api/admin/linkedin/accounts/:id/connection-readiness', requireAdmin, async (req, res) => {
    const id = accountId(req.params.id)
    if (!id) { res.status(400).json({ error: 'connection_account_id_invalid' }); return }
    try { res.json(await service.readiness(id)) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.get('/api/admin/linkedin/accounts/:id/connection-history', requireAdmin, async (req, res) => {
    const id = accountId(req.params.id)
    if (!id) { res.status(400).json({ error: 'connection_account_id_invalid' }); return }
    try { res.json({ items: await service.history(id) }) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.put('/api/admin/linkedin/accounts/:id/connection-stack', requireAdmin, async (req, res) => {
    const id = accountId(req.params.id); const stackId = accountId(req.body?.stackId)
    if (!id || !stackId) { res.status(400).json({ error: 'connection_stack_request_invalid' }); return }
    try { res.json(await service.saveStack(id, stackId)) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.post('/api/admin/linkedin/accounts/:id/connection-runs', requireAdmin, async (req, res) => {
    const id = accountId(req.params.id)
    if (!id || (req.body?.safeRecruiterOnly !== undefined &&
      typeof req.body.safeRecruiterOnly !== 'boolean')) {
      res.status(400).json({ error: 'connection_run_request_invalid' }); return
    }
    try { res.status(202).json(await service.start(id, {
      safeRecruiterOnly: req.body?.safeRecruiterOnly === true })) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
}
