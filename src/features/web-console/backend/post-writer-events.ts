import type { Express, RequestHandler, Request } from 'express'
import type { PostWriterService } from '../../linkedin-automation/post-writer/service.ts'
import { postFailure } from './post-writer-routes.ts'

export function registerPostEvents(app: Express, requireAdmin: RequestHandler,
  service: PostWriterService, parseId: (req: Request) => number) {
  app.get('/api/admin/linkedin/accounts/:id/post-writer/events', requireAdmin, async (req, res) => {
    let unsubscribe: (() => void) | undefined
    let timer: NodeJS.Timeout | undefined
    let closed = false
    res.on('close', () => { closed = true; unsubscribe?.(); if (timer) clearInterval(timer) })
    try {
      const account = parseId(req)
      const initial = await service.get(account)
      if (closed) return
      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
      res.flushHeaders()
      const send = (snapshot: unknown) => { if (!closed) res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`) }
      let serial = Promise.resolve()
      unsubscribe = service.subscribe(account, () => {
        serial = serial.then(async () => send(await service.get(account))).catch(() => {
          if (!closed) res.write('event: unavailable\ndata: {}\n\n')
        })
      })
      send(initial)
      timer = setInterval(() => { if (!closed) res.write(': keepalive\n\n') }, 15_000)
      timer.unref()
    } catch (error) { if (!closed && !res.headersSent) postFailure(res, error); else res.end() }
  })
}
