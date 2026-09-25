import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { chromium, request } from 'playwright'
import express from 'express'
import { fixture, pausedLikesFixture } from '../../linkedin-automation/post-writer/tests/helpers.ts'
import { PostError } from '../../linkedin-automation/post-writer/errors.ts'
const require = createRequire(resolve('package.json'))
const { createWebConsoleApp, ADMIN_EMAIL, ADMIN_PASSWORD } = require('./src/features/web-console/backend/app.ts')

export async function checkManualLikes(disconnected = false, resume = false) {
  const f = resume ? await pausedLikesFixture() : fixture()
  if (!resume) { await f.service.start(203, 'automatic', 'manual-likes-ui'); await f.untilPublished() }
  if (disconnected) f.deps.adapter.identity = async account => {
    if (account.platformAccountId === 902) throw new PostError('post_account_not_ready')
  }
  const expectedLikes = disconnected ? 5 : 6
  const expectedLabel = disconnected ? 'Лайки: Выполнены частично' : 'Лайки: Завершены'
  const run = await f.run(), app = createWebConsoleApp({ useMockData: true, postWriter: f.service })
  app.use(express.static(resolve('dist/web-console')))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const guest = await request.newContext()
    try { assert.equal((await guest.post(`${base}/api/admin/linkedin/post-runs/${run.id}/start-likes`)).status(), 401) }
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
    if (resume) assert.equal(await page.getByTestId('post-likes-start').innerText(), 'Продолжить лайки')
    await page.getByTestId('post-likes-start').click()
    await page.getByRole('alertdialog', { name: 'Запустить лайки к посту' }).getByRole('button', { name: 'Отмена' }).click()
    assert.equal((await f.run()).engagement.status, resume ? 'partial' : 'off')
    assert.equal(f.counts.like, resume ? 1 : 0)
    await page.getByTestId('post-likes-start').click()
    const response = page.waitForResponse(value => value.url().endsWith('/start-likes'))
    await page.getByTestId('post-likes-confirm').click()
    assert.equal((await response).status(), 200)
    // Finish the action's refresh before advancing the fake scheduler clock.
    await page.waitForFunction(() => {
      const stop = document.querySelector<HTMLButtonElement>('[data-testid="post-stop"]')
      return stop && !stop.disabled
    })
    for (let i = 0; i < 20; i++) await f.step(90_001)
    await page.getByTestId('post-progress').getByText(expectedLabel, { exact: false }).waitFor()
    assert.equal(f.counts.like, expectedLikes); assert.equal(f.counts.publish, 1)
    if (disconnected) {
      assert.equal((await f.run()).engagement.items[1].status, 'failed')
      assert.equal((await f.run()).engagement.items[1].errorCode, 'post_account_not_ready')
      const snapshot = await (await page.request.get(`${base}/api/admin/linkedin/accounts/203/post-writer`)).json()
      assert.equal(snapshot.runs[0].engagement.items[1].errorCode, 'post_account_not_ready')
      assert.equal(await page.getByTestId('post-like-skipped').count(), 1,
        await page.getByTestId('post-progress').innerText())
      assert.match(await page.getByTestId('post-like-skipped').innerText(), /Mock student 2: пропущен.*аккаунт отключён или заблокирован/)
      assert.equal((await f.run()).engagement.items[1].attemptedAt, undefined)
    }
    assert.equal(await page.getByTestId('post-likes').isChecked(), false)
    await page.reload()
    await page.getByTestId('admin-linkedin-tab').click()
    await page.getByTestId('post-writer-203').click()
    await page.getByTestId('post-progress').getByText(expectedLabel, { exact: false }).waitFor()
    if (disconnected) await page.getByTestId('post-like-skipped').waitFor()
    assert.equal(await page.getByTestId('post-likes-start').count(), 0)
    assert.equal((await page.request.post(`${base}/api/admin/linkedin/post-runs/${run.id}/start-likes`)).status(), 200)
    await f.step(90_001); assert.equal(f.counts.like, expectedLikes); assert.equal(f.counts.publish, 1)
    assert.deepEqual(errors, [])
    console.log(`Manual likes UI passed: admin-only, cancel, start, ${expectedLikes} verified likes, skipped=${disconnected}, resume=${resume}, reload, no duplicates.`)
  } finally {
    await browser?.close(); await f.service.close()
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
