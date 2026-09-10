type App = import('express').Express
type Handler = import('express').RequestHandler
type Service = import('./profile-filler-types').ProfileFillerService
const { runProfileAnalysis } = require('../../linkedin-automation/profile-filler/profile-analysis.ts') as
  typeof import('../../linkedin-automation/profile-filler/profile-analysis.ts')
const { cvUploadFailure, parseCvBody, readCvUpload } = require('./profile-generation-upload.ts') as
  { cvUploadFailure(error: any): any; parseCvBody: Handler; readCvUpload(req: any): any }
const CONFLICT_MESSAGES: Record<string, string> = {
  linkedin_provider_id_mismatch: 'Аккаунт LinkedIn изменился. Обновите подключение перед редактированием.',
  profile_generation_stop_unavailable: 'Можно остановить только подготовку Preview, не заполнение LinkedIn.',
  profile_generation_stopped: 'Подготовка остановлена. Можно запустить новую генерацию.',
  profile_preview_stale: 'LinkedIn changed after this preview. Build a fresh preview before Apply.',
  profile_section_unavailable: 'LinkedIn did not return a required section. Wait and build a fresh preview.',
  profile_entry_ambiguous: 'Several CV entries match the same LinkedIn entry. Resolve the match and rebuild Preview.',
  profile_current_status_unsupported: 'Mark the entry as current in LinkedIn, then build a fresh preview.',
  profile_filler_auth_required: 'Verify or reconnect LinkedIn before using Profile Filler.',
  profile_job_not_ready: 'This preview can no longer be applied. Build a fresh preview.',
  profile_plan_hash_mismatch: 'This preview is outdated. Build a fresh preview before applying.',
  profile_preview_has_blocking_issues: 'Fix the blocking fields and build a fresh preview.',
  linkedin_operation_active: 'Another LinkedIn operation is running. Wait for it to finish and retry.',
  profile_rollback_not_available: 'Rollback is not available for this run.',
  profile_rollback_state_changed: 'LinkedIn changed after this run. Build a fresh preview before rollback.',
  profile_rollback_unsupported: 'This type of change cannot be rolled back automatically.',
  profile_already_rolled_back: 'This run has already been rolled back.',
  profile_retry_not_ready: 'This generation is not waiting for retry.',
  profile_retry_unavailable: 'The saved generation checkpoint is unavailable.'
}
function failure(error: any) {
  const code = String(error?.code ?? 'profile_filler_internal_error')
  if (code === 'profile_field_invalid') return { status: 422, body: { error: code,
    message: 'Поле не прошло проверку.', issues: Array.isArray(error.details) ? error.details : [] } }
  if (code === 'profile_parameter_search_invalid') {
    return { status: 400, body: { error: code, message: 'Enter at least two characters.' } }
  }
  if (code === 'profile_validation_failed') {
    return { status: 400, body: { error: code, message: 'Profile JSON is invalid.',
      issues: Array.isArray(error.details) ? error.details : [] } }
  }
  const uploadFailure = cvUploadFailure(error)
  if (uploadFailure) return uploadFailure
  if (code === 'profile_job_not_found' || code === 'linkedin_account_not_found') {
    return { status: 404, body: { error: code, message: 'Profile Filler item was not found.' } }
  }
  if (code === 'noco_rate_limited' || error?.response?.status === 429) {
    return { status: 429, body: { error: 'noco_rate_limited',
      message: 'NocoDB is busy. Wait 30 seconds and retry.' } }
  }
  if (Object.hasOwn(CONFLICT_MESSAGES, code)) {
    return { status: 409, body: { error: code, message: `[${code}] ${CONFLICT_MESSAGES[code]}` } }
  }
  if (code === 'profile_state_persist_failed') return { status: 503, body: { error: code,
    message: 'The job state could not be saved. Further writes are blocked; check the saved result before retrying.' } }
  return { status: 500, body: { error: 'profile_filler_internal_error',
    message: 'Profile Filler failed.' } }
}

function registerProfileFillerRoutes(options: {
  app: App; requireAdmin: Handler; service: Service
}) {
  const { app, requireAdmin, service } = options
  app.post('/api/admin/linkedin/profile-analysis', requireAdmin, (req, res) => {
    try { res.json(runProfileAnalysis(req.body)) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.get('/api/admin/linkedin/profile-jobs', requireAdmin, async (req, res) => {
    const id = req.query.platformAccountId === undefined ? undefined : Number(req.query.platformAccountId)
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0 || typeof req.query.platformAccountId !== 'string')) {
      res.status(400).json({ error: 'profile_validation_failed' }); return
    }
    try { res.json({ jobs: await service.list(id) }) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.get('/api/admin/linkedin/profile-jobs/:jobId', requireAdmin, async (req, res) => {
    try {
      const job = await service.get(String(req.params.jobId))
      if (!job) { res.status(404).json({ error: 'profile_job_not_found' }); return }
      res.json(job)
    } catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.post('/api/admin/linkedin/accounts/:id/profile-previews', requireAdmin, async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0 || JSON.stringify(req.body).length > 250_000) {
      res.status(400).json({ error: 'profile_validation_failed', message: 'Profile JSON is invalid.' }); return
    }
    try { res.status(202).json(await service.startPreview(id, req.body)) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.post('/api/admin/linkedin/accounts/:id/profile-generations', requireAdmin, parseCvBody,
    async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'profile_validation_failed' }); return
    }
    try { res.status(202).json(await service.startGeneration(id, readCvUpload(req))) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.get('/api/admin/linkedin/accounts/:id/profile-parameters', requireAdmin, async (req, res) => {
    const id = Number(req.params.id)
    try {
      res.json(await service.searchParameters(id, String(req.query.type ?? ''),
        String(req.query.keywords ?? '')))
    } catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.post('/api/admin/linkedin/profile-jobs/:jobId/apply', requireAdmin, async (req, res) => {
    try { res.status(202).json(await service.apply(String(req.params.jobId), String(req.body?.planHash ?? ''))) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.post('/api/admin/linkedin/profile-jobs/:jobId/fields', requireAdmin, async (req, res) => {
    if (typeof req.body?.path !== 'string' || typeof req.body?.planHash !== 'string' ||
      JSON.stringify(req.body).length > 30_000 ||
      (Object.hasOwn(req.body, 'enabled') && (typeof req.body.enabled !== 'boolean' || Object.hasOwn(req.body, 'value')))) {
      res.status(400).json({ error: 'profile_field_invalid', message: 'Неверный запрос изменения поля.' }); return
    }
    try { res.json(await service.editField(String(req.params.jobId), req.body.planHash,
      Object.hasOwn(req.body, 'enabled') ? { path: req.body.path, enabled: req.body.enabled }
        : { path: req.body.path, value: req.body.value })) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.post('/api/admin/linkedin/profile-jobs/:jobId/resume', requireAdmin, async (req, res) => {
    try { res.status(202).json(await service.resume(String(req.params.jobId))) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.post('/api/admin/linkedin/profile-jobs/:jobId/stop-generation', requireAdmin, async (req, res) => {
    try { res.status(202).json(await service.stopGeneration(String(req.params.jobId))) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
  app.post('/api/admin/linkedin/profile-jobs/:jobId/rollback', requireAdmin, async (req, res) => {
    try { res.status(202).json(await service.rollback(String(req.params.jobId))) }
    catch (error) { const result = failure(error); res.status(result.status).json(result.body) }
  })
}

module.exports = { failure, registerProfileFillerRoutes }
