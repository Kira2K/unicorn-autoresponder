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
  const messages: Record<string, string> = {
    post_prepared_invalid: 'Нужно не больше семи постов за одну неделю: разные даты и до 3000 знаков в каждом тексте.',
    post_prepared_day_started: 'Пост на эту дату уже запущен. Его текст не изменён; результат доступен в истории.',
    post_prepared_manual_unavailable: 'В режиме готовых постов используется план по датам. Для генерации из CV смените режим.',
    post_prepared_changed: 'Текст или режим изменился. Сохраните план и проверьте его перед публикацией.',
    post_prepared_past: 'Дата уже прошла. Выберите сегодняшний или будущий день.',
    post_account_busy: 'У этого аккаунта уже есть незавершённое задание. Дождитесь результата или остановите его.',
    meme_generation_disabled: 'Генерация мемов на сервере выключена. Пост без заказанного мема не публикуется.'
  }
  const status = code === 'post_run_not_found' ? 404 : code.includes('invalid') ? 400 :
    ['post_hash_mismatch', 'post_action_invalid', 'meme_review_required', 'post_prepared_day_started',
      'post_prepared_manual_unavailable', 'post_prepared_changed', 'post_prepared_past', 'post_account_busy'].includes(code) ? 409 : 503
  res.status(status).json({ error: code, message: messages[code] ?? (code === 'post_writer_read_only'
    ? 'Post Writer работает только на чтение.' : code === 'post_schema_missing'
      ? 'Нужна миграция таблиц Post Writer. Другие функции доступны.'
      : `Post Writer: ${code}`) })
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
  app.post(`${base}/prepared-runs`, requireAdmin, async (req, res) => {
    try { res.status(202).json(await service.startPrepared(id(req), req.body)) }
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
