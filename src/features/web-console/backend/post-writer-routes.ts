import type { Express, Request, Response, RequestHandler } from 'express'
import type { PostWriterService } from '../../linkedin-automation/post-writer/service.ts'
import { errorCode, PostError } from '../../linkedin-automation/post-writer/errors.ts'
import { registerPostEvents } from './post-writer-events.ts'
import { defaults } from '../../linkedin-automation/post-writer/types.ts'

const id = (req: Request) => {
  const value = Number(req.params.id)
  if (!Number.isSafeInteger(value) || value <= 0) throw new PostError('post_account_invalid')
  return value
}
export function postFailure(res: Response, error: unknown) {
  const code = errorCode(error)
  const status = code === 'post_run_not_found' ? 404 : code.includes('invalid') ? 400 :
    ['post_hash_mismatch', 'post_action_invalid', 'meme_review_required'].includes(code) ? 409 : 503
  res.status(status).json({ error: code, message: code === 'post_writer_read_only'
    ? 'Post Writer работает только на чтение.' : code === 'post_schema_missing'
      ? 'Нужна миграция таблиц Post Writer. Другие функции доступны.'
      : `Post Writer: ${code}` })
}
export function registerPostWriterRoutes(app: Express, requireAdmin: RequestHandler, service: PostWriterService) {
  app.get('/api/admin/linkedin/post-writer/policy', requireAdmin, async (_req, res) => {
    try { res.json((await service.get(0)).settings.forbiddenTopics ?? []) } catch (error) { postFailure(res, error) }
  })
  app.put('/api/admin/linkedin/post-writer/policy', requireAdmin, async (req, res) => {
    try { res.json((await service.update(0, { ...defaults(0), forbiddenTopics: req.body })).settings.forbiddenTopics) }
    catch (error) { postFailure(res, error) }
  })
  const base = '/api/admin/linkedin/accounts/:id/post-writer'
  app.get(base, requireAdmin, async (req, res) => {
    try { res.json(await service.get(id(req))) } catch (error) { postFailure(res, error) }
  })
  app.put(`${base}/settings`, requireAdmin, async (req, res) => {
    try { res.json(await service.update(id(req), req.body)) } catch (error) { postFailure(res, error) }
  })
  app.post(`${base}/runs`, requireAdmin, async (req, res) => {
    try { res.status(202).json(await service.start(id(req), req.body?.mode, req.body?.requestKey,
      { topic: req.body?.topic, cv: req.body?.cv })) }
    catch (error) { postFailure(res, error) }
  })
  app.get('/api/admin/linkedin/post-runs/:runId/meme', requireAdmin, async (req, res) => {
    try {
      const file = await service.image(String(req.params.runId))
      res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
        .type('png').send(Buffer.from(file.content, 'base64'))
    } catch (error) { postFailure(res, error) }
  })
  app.post('/api/admin/linkedin/post-runs/:runId/:action', requireAdmin, async (req, res) => {
    try { res.json(await service.action(String(req.params.runId), String(req.params.action),
      req.body?.contentHash, req.body?.memeReviewedHash)) }
    catch (error) { postFailure(res, error) }
  })
  registerPostEvents(app, requireAdmin, service, id)
}
