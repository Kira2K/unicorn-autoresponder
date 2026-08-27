type ExpressApp = import('express').Express
type RequestHandler = import('express').RequestHandler
type RunService = import('./linkedin-auth-types.ts').LinkedInAuthRunService
type Action = import('./linkedin-auth-types.ts').LinkedInAuthAction

const ACTIONS = new Set<Action>(['check', 'connect', 'force_reauth'])

function routeFailure(error: any) {
  const code = String(error?.code ?? 'linkedin_auth_internal_error')
  if (error?.response?.status === 429) {
    return {
      status: 503,
      body: { error: 'noco_rate_limited', message: 'NocoDB is busy. Wait a minute and refresh the list.' }
    }
  }
  if (code === 'linkedin_auth_run_active') {
    return { status: 409, body: { error: code, message: 'Another LinkedIn run is active.' } }
  }
  if (code === 'linkedin_account_not_found') {
    return { status: 404, body: { error: code, message: 'LinkedIn account was not found.' } }
  }
  if (code === 'linkedin_auth_action_invalid') {
    return { status: 400, body: { error: code, message: 'LinkedIn action is invalid.' } }
  }
  if (code === 'linkedin_url_missing' || code === 'linkedin_url_invalid') {
    return { status: 400, body: { error: code, message: 'Enter a valid LinkedIn /in/ profile URL.' } }
  }
  return {
    status: 500,
    body: { error: 'linkedin_auth_internal_error', message: 'LinkedIn authentication failed.' }
  }
}

function registerLinkedInAuthRoutes(options: {
  app: ExpressApp
  requireAdmin: RequestHandler
  service: RunService
}) {
  const { app, requireAdmin, service } = options
  app.get('/api/admin/linkedin/accounts', requireAdmin, async (_req, res) => {
    try { res.json({ accounts: await service.listAccounts() }) } catch (error) {
      const failure = routeFailure(error)
      res.status(failure.status).json(failure.body)
    }
  })
  app.post('/api/admin/linkedin/accounts/:id/runs', requireAdmin, async (req, res) => {
    const platformAccountId = Number(req.params.id)
    const action = String(req.body?.action ?? '') as Action
    if (!Number.isInteger(platformAccountId) || platformAccountId <= 0 || !ACTIONS.has(action)) {
      res.status(400).json({ error: 'linkedin_auth_action_invalid', message: 'LinkedIn action is invalid.' })
      return
    }
    try {
      res.status(202).json(await service.start(platformAccountId, action))
    } catch (error) {
      const failure = routeFailure(error)
      res.status(failure.status).json(failure.body)
    }
  })
  app.patch('/api/admin/linkedin/accounts/:id', requireAdmin, async (req, res) => {
    const platformAccountId = Number(req.params.id)
    if (!Number.isInteger(platformAccountId) || platformAccountId <= 0) {
      res.status(400).json({ error: 'linkedin_account_invalid', message: 'LinkedIn account ID is invalid.' })
      return
    }
    try {
      res.json(await service.updateAccount(platformAccountId, { linkedinUrl: req.body?.linkedinUrl }))
    } catch (error) {
      const failure = routeFailure(error)
      res.status(failure.status).json(failure.body)
    }
  })
  app.get('/api/admin/linkedin/runs', requireAdmin, async (_req, res) => {
    try { res.json({ runs: await service.listHistory() }) } catch (error) {
      const failure = routeFailure(error)
      res.status(failure.status).json(failure.body)
    }
  })
  app.get('/api/admin/linkedin/runs/:runId', requireAdmin, (req, res) => {
    const run = service.get(String(req.params.runId ?? ''))
    if (!run) {
      res.status(404).json({ error: 'linkedin_auth_run_not_found', message: 'Run was not found.' })
      return
    }
    res.json(run)
  })
}

module.exports = { registerLinkedInAuthRoutes, routeFailure }
