import assert from 'node:assert/strict'
import { chromium, request } from 'playwright'
import { startIsolatedPostTestProcesses, waitPostHttp, postRoot } from './post-writer-processes.ts'
import { checkPreparedPosts } from './post-prepared-check.ts'

export async function checkPreparedNow() {
  const processes = await startIsolatedPostTestProcesses(), base = `http://127.0.0.1:${processes.uiPort}`
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    await waitPostHttp(`http://127.0.0.1:${processes.apiPort}/api/auth/me`, processes.backend)
    await waitPostHttp(base, processes.frontend)
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 1120 } }), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
      ? route.continue() : route.abort())
    await page.goto(base)
    await page.getByTestId('email-input').fill('unicornveryevil@gmail.com')
    await page.locator('input[type="password"]').fill('101010')
    await page.getByTestId('login-button').click()
    await page.getByTestId('admin-linkedin-tab').click()
    await page.getByTestId('post-writer-203').click()
    await checkPreparedPosts(page, base)
    const api = `${base}/api/admin/linkedin/accounts/203/post-writer`
    const read = async () => (await page.request.get(api)).json()
    const before = await read(), post = before.settings.preparedPosts[0]
    assert.equal(before.runs.length, 0); assert.equal(before.settings.scheduled, false)
    await page.getByTestId('post-prepared-day-1').click()
    for (const [width, height, name] of [[1440, 1120, 'prepared-now-desktop'], [390, 844, 'prepared-now-mobile']] as const) {
      await page.setViewportSize({ width, height })
      const overflow = await page.getByTestId('post-writer-dialog').evaluate(element =>
        [element, ...element.querySelectorAll('.settings-layout, .content-panel, .day-editor')]
          .some(item => item.scrollWidth > item.clientWidth + 2))
      assert.equal(overflow, false, `Writer should fit ${width}px viewport`)
      await page.screenshot({ path: `${postRoot}/logs/post-writer-checks/${name}.png` })
      if (width === 390) {
        await page.getByTestId('post-prepared-publish').scrollIntoViewIfNeeded()
        await page.screenshot({ path: `${postRoot}/logs/post-writer-checks/prepared-now-mobile-editor.png` })
        await page.getByTestId('post-prepared-publish').click()
        await page.getByTestId('post-prepared-confirm').waitFor()
        await page.getByTestId('post-prepared-cancel').click()
        assert.equal((await read()).runs.length, 0)
      }
    }
    await page.setViewportSize({ width: 1440, height: 1120 })
    await page.getByTestId('post-prepared-publish').click()
    assert.match(await page.getByTestId('post-prepared-confirm').innerText(), /Connected Client/)
    await page.getByTestId('post-prepared-cancel').click()
    assert.equal((await read()).runs.length, 0, 'cancel must not create a run')
    const guest = await request.newContext()
    try { assert.equal((await guest.post(`${api}/prepared-runs`, { data: post })).status(), 401) }
    finally { await guest.dispose() }
    const stale = await page.request.post(`${api}/prepared-runs`, { data: { ...post, text: 'unsaved edit' } })
    assert.equal(stale.status(), 409); assert.equal((await read()).runs.length, 0)
    await page.getByTestId('post-prepared-publish').click()
    await page.screenshot({ path: `${postRoot}/logs/post-writer-checks/prepared-now-confirm.png` })
    const sent = page.waitForResponse(response => response.url() === `${api}/prepared-runs`)
    await page.getByTestId('post-prepared-confirm-send').click()
    assert.equal((await sent).status(), 202)
    await page.getByTestId('post-progress').getByRole('heading', { name: 'Пост опубликован' }).waitFor({ timeout: 30_000 })
    const after = await read(), run = after.runs[0]
    assert.equal(after.runs.length, 1); assert.equal(run.draft.text, post.text)
    assert.equal(run.id, `scheduled-203-${post.date}`); assert.equal(run.trigger, 'manual')
    assert.ok(run.postImageId); assert.equal(run.meme.imageCalls, 1)
    assert.equal(after.settings.scheduled, false)
    assert.deepEqual(after.settings.preparedPosts, before.settings.preparedPosts)
    const replay = await page.request.post(`${api}/prepared-runs`, { data: post })
    assert.equal(replay.status(), 202); assert.equal((await replay.json()).id, run.id)
    assert.equal((await read()).runs.length, 1)
    await page.reload()
    await page.getByTestId('admin-linkedin-tab').click()
    await page.getByTestId('post-writer-203').click()
    await page.getByTestId('post-prepared-day-1').click()
    assert.equal(await page.getByTestId('post-prepared-1').isDisabled(), true)
    assert.equal(await page.getByTestId('post-prepared-publish').isDisabled(), true)
    await page.getByTestId('post-prepared-day-3').click()
    assert.equal(await page.getByTestId('post-prepared-3').isEnabled(), true)
    assert.equal(await page.getByTestId('post-prepared-publish').isEnabled(), true)
    assert.deepEqual(errors, [])
    console.log('Publish-now UI passed: saved text, cancel, permissions, stale input, meme, no duplicate, reload, mobile.')
  } finally { await browser?.close(); processes.close() }
}
