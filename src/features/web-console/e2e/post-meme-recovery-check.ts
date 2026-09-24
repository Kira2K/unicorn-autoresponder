import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { chromium, request } from 'playwright'
import express from 'express'
import { fixture } from '../../linkedin-automation/post-writer/tests/helpers.ts'
import { defaults } from '../../linkedin-automation/post-writer/types.ts'
const require = createRequire(resolve('package.json'))
const { createWebConsoleApp, ADMIN_EMAIL, ADMIN_PASSWORD } = require('./src/features/web-console/backend/app.ts')

export async function checkMemeRecovery() {
  const f = fixture(), plan = f.deps.memes!.plan
  f.deps.memes!.plan = async () => ({ status: 'blocked', reason: 'legacy fixture', concept: null })
  await f.service.update(203, { ...defaults(203), memes: true })
  await f.service.start(203, 'automatic', 'legacy-meme-ui')
  await f.step()
  const legacy = await f.run(), text = legacy.draft!.text
  legacy.errorCode = legacy.meme!.errorCode = 'meme_prompt_invalid'
  legacy.meme!.plannerCalls = 1; legacy.meme!.blockingReason = undefined
  await f.deps.store.put('runs', legacy.id, legacy)
  f.deps.memes!.plan = plan
  f.deps.memes!.review = async () => ({ issues: ['weak_relevance'], repair: 'Make the connection clearer' })
  f.restart()
  const app = createWebConsoleApp({ useMockData: true, postWriter: f.service })
  app.use(express.static(resolve('dist/web-console')))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const guest = await request.newContext()
    try { assert.equal((await guest.post(`${base}/api/admin/linkedin/post-runs/${legacy.id}/retry-meme`)).status(), 401) }
    finally { await guest.dispose() }
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } }), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
    await page.goto(base)
    await page.getByTestId('email-input').fill(ADMIN_EMAIL)
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD)
    await page.getByTestId('login-button').click()
    await page.getByTestId('admin-linkedin-tab').click()
    await page.getByTestId('post-writer-203').click()
    await page.getByTestId('post-meme-retry').click()
    mkdirSync('logs/post-writer-checks', { recursive: true })
    await page.getByTestId('post-meme-recovery').screenshot({ path: 'logs/post-writer-checks/meme-recovery-confirm.png', animations: 'disabled' })
    await page.getByRole('alertdialog', { name: 'Продолжить публикацию' }).getByRole('button', { name: 'Отмена' }).click()
    assert.equal((await f.run()).status, 'blocked'); assert.equal(f.counts.publish, 0)
    await page.getByTestId('post-meme-retry').click()
    const response = page.waitForResponse(value => value.url().endsWith('/retry-meme'))
    await page.getByTestId('post-meme-retry-confirm').click()
    assert.equal((await response).status(), 200)
    await f.step(); await f.step(6000)
    await page.getByTestId('post-progress').getByRole('heading', { name: 'Пост опубликован' }).waitFor()
    assert.equal((await f.run()).draft!.text, text); assert.ok((await f.run()).postImageId)
    assert.equal(f.counts.publish, 1); assert.equal((await f.service.get(203)).runs.length, 1)
    assert.match(await page.getByTestId('post-meme-qa').innerText(), /есть замечания/)
    await page.reload()
    await page.getByTestId('admin-linkedin-tab').click()
    await page.getByTestId('post-writer-203').click()
    await page.getByTestId('post-meme-qa').waitFor()
    assert.equal(await page.getByTestId('post-meme-retry').count(), 0)
    const repeated = await page.request.post(`${base}/api/admin/linkedin/post-runs/${legacy.id}/retry-meme`)
    assert.equal(repeated.status(), 409); assert.equal(f.counts.publish, 1)
    await page.getByTestId('post-meme-qa').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'logs/post-writer-checks/meme-recovery.png', animations: 'disabled' })
    assert.deepEqual(errors, [])
    console.log('Meme recovery UI passed: permission, cancel, same job, QA warnings, image publication, reload, no duplicate.')
  } finally {
    await browser?.close(); await f.service.close()
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
