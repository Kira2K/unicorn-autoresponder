import express from 'express'
import { createHash, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import { createTextRuntime } from './text-runtime.ts'
import { registerPostTextRoutes } from '../../web-console/backend/post-text-routes.ts'
import { PostError } from './errors.ts'

export async function startStandalone(env = process.env) {
  const mock = env.LINKEDIN_POST_TEXT_MOCK === 'true'
  const token = env.LINKEDIN_POST_TEXT_TOKEN ?? ''
  if (token.length < 24) throw new PostError('post_text_token_missing')
  const hash = (value: string) => createHash('sha256').update(value).digest()
  const workspace = createTextRuntime(mock, env)
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '22mb' }))
  registerPostTextRoutes(app, (req, res, next) => {
    if (!timingSafeEqual(hash(req.headers.authorization ?? ''), hash(`Bearer ${token}`))) {
      res.status(401).json({ message: 'Нужен ключ доступа к отдельному Writer.' }); return
    }
    res.setHeader('Cache-Control', 'no-store')
    next()
  }, workspace)
  const assets = resolve('dist/web-console')
  app.get('/', (_req, res) => res.sendFile('writer.html', { root: assets }))
  app.use(express.static(assets, { index: false }))
  const server = app.listen(Number(env.LINKEDIN_POST_TEXT_PORT || 4310), '127.0.0.1')
  await new Promise<void>((accept, reject) => { server.once('listening', accept); server.once('error', reject) })
  const close = async () => { await workspace.close(); server.close() }
  process.once('SIGINT', () => void close())
  process.once('SIGTERM', () => void close())
  console.log(`Standalone text Writer: http://127.0.0.1:${(server.address() as { port: number }).port}`)
  return { server, close }
}
