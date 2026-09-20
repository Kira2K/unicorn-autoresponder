import type { Express, RequestHandler } from 'express'
import type { WithdrawalService } from '../../linkedin-automation/invitation-withdrawal/contracts.ts'
export function registerInvitationWithdrawalRoutes(app: Express, requireAdmin: RequestHandler,
  service: () => WithdrawalService | undefined) {
  const base = '/api/admin/linkedin/accounts/:id/invitation-withdrawal'
  const handler = (action: 'preview' | 'status' | 'start' | 'stop' | 'recheck'): RequestHandler => async (req, res) => {
    const id = Number(req.params.id)
    if (!/^\d+$/.test(String(req.params.id)) || !Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: 'withdrawal_account_invalid', message: 'Неверный ID аккаунта.' }); return
    }
    if (action === 'start' && (typeof req.body?.token !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(req.body.token) || req.body?.confirm !== true)) {
      res.status(400).json({ error: 'withdrawal_confirmation_required', message: 'Подтвердите список отзывов.' }); return
    }
    if (action === 'recheck' && (typeof req.body?.runId !== 'string' || !/^[a-f0-9-]{36}$/.test(req.body.runId))) {
      res.status(400).json({ error: 'withdrawal_run_invalid', message: 'Откройте задание заново.' }); return
    }
    try {
      const operations = service()
      if (!operations) { res.status(503).json({ error: 'withdrawal_unavailable',
        message: 'Отзыв приглашений не подключён в этом режиме.' }); return }
      const result = action === 'start' ? await operations.start(id, req.body.token) : action === 'recheck'
        ? await operations.recheck(id, req.body.runId) : await operations[action](id)
      res.status(action === 'start' ? 202 : 200).json(result ?? null)
    } catch (error: any) {
      const code = String(error?.code ?? '')
      const known = code.startsWith('withdrawal_')
      const forbidden = code === 'connection_account_not_allowed'
      res.status(forbidden ? 403 : known || code === 'linkedin_operation_active' ? 409 : 503).json({
        error: known ? code : 'withdrawal_unavailable',
        message: known ? error.message : forbidden ? 'Аккаунт не разрешён для этого запуска.' :
          code === 'linkedin_operation_active' ? 'Дождитесь завершения другой операции этого аккаунта.' :
          'Не удалось проверить приглашения. Проверьте подключение и повторите позже.'
      })
    }
  }
  app.get(`${base}/preview`, requireAdmin, handler('preview'))
  app.get(base, requireAdmin, handler('status'))
  app.post(base, requireAdmin, handler('start'))
  app.post(`${base}/stop`, requireAdmin, handler('stop'))
  app.post(`${base}/recheck`, requireAdmin, handler('recheck'))
}
