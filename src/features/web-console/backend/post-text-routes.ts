import type { Express, RequestHandler } from 'express'
import type { TextWorkspace } from '../../linkedin-automation/post-writer/text-workspace.ts'
import { postFailure } from './post-writer-routes.ts'
export function registerPostTextRoutes(app: Express, admin: RequestHandler, workspace: TextWorkspace) {
  const base = '/api/post-writer/text'
  app.get(base, admin, async (_req, res) => {
    try { res.json(await workspace.snapshot()) } catch (error) { postFailure(res, error) }
  })
  app.get(`${base}/jobs/:id/meme`, admin, async (req, res) => {
    try {
      const file = await workspace.image(String(req.params.id))
      res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
        .type('png').send(Buffer.from(file.content, 'base64'))
    } catch (error) { postFailure(res, error) }
  })
  app.put(`${base}/authors/:id`, admin, async (req, res) => {
    try { res.json(await workspace.saveAuthor(String(req.params.id), req.body?.author, req.body?.cv)) }
    catch (error) { postFailure(res, error) }
  })
  app.put(`${base}/policy`, admin, async (req, res) => {
    try { await workspace.savePolicy(req.body); res.json({ saved: true }) }
    catch (error) { postFailure(res, error) }
  })
  app.post(`${base}/authors/:id/jobs`, admin, async (req, res) => {
    try { res.status(202).json(await workspace.start(String(req.params.id), req.body?.requestKey, req.body?.topic)) }
    catch (error) { postFailure(res, error) }
  })
  app.post(`${base}/jobs/:id/stop`, admin, async (req, res) => {
    try { await workspace.stop(String(req.params.id)); res.json({ stopped: true }) }
    catch (error) { postFailure(res, error) }
  })
}
