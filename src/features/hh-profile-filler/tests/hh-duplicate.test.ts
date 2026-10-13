import assert from 'node:assert/strict'
import { requestNativeResumeClone } from '../hh-duplicate.ts'
import { chromium } from 'playwright'
import { duplicateResumeVariant } from '../hh-resume-ui.ts'

export async function runHHCloneTests() {
  const sourceId = 'a'.repeat(34)
  const cloneId = 'b'.repeat(34)
  const recorded: string[] = []
  let calls = 0
  const page = (response: unknown) => ({
    url: () => 'https://hh.ru/profile/resume/experience',
    evaluate: async (_fn: unknown, id: string) => {
      calls += 1
      assert.equal(id, sourceId)
      if (response instanceof Error) throw response
      return response
    }
  }) as any
  assert.equal(await requestNativeResumeClone(page({ status: 200,
    url: `/profile/resume/?resume=${cloneId}` }), sourceId,
  id => { recorded.push(id) }), cloneId)
  assert.deepEqual(recorded, [cloneId])
  for (const response of [
    { status: 200, url: `/profile/resume/?resume=${sourceId}` },
    { status: 200, url: `https://example.com/profile/resume/?resume=${cloneId}` },
    { status: 200, url: '/profile/resume/' },
    new Error('Network interrupted after POST')
  ]) {
    const before = calls
    await assert.rejects(requestNativeResumeClone(page(response), sourceId,
      () => { throw new Error('Invalid clone must not be recorded') }),
    { code: 'profile_hh_duplicate_outcome_unknown' })
    assert.equal(calls, before + 1, 'An uncertain write must never retry automatically')
  }
  await assert.rejects(requestNativeResumeClone(page({ status: 400,
    error: 'max_resume_limit_exceeded' }), sourceId, () => undefined),
  { code: 'profile_hh_resume_limit' })
  await assert.rejects(requestNativeResumeClone(page({ status: 403 }), sourceId,
    () => undefined), { code: 'profile_hh_duplicate_rejected' })

  const browser = await chromium.launch({ headless: true }).catch(() =>
    chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const context = await browser.newContext()
    await context.addCookies([{ name: '_xsrf', value: 'test-xsrf', url: 'https://hh.ru' }])
    const livePage = await context.newPage()
    let title = ''
    let saves = 0
    let clonePosts = 0
    await livePage.route('**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname === '/applicant/resumes/clone') {
        clonePosts += 1
        assert.equal(request.method(), 'POST')
        assert.equal(url.searchParams.get('resume'), sourceId)
        assert.equal(request.headers()['x-xsrftoken'], 'test-xsrf')
        return route.fulfill({ json: { url: `/profile/resume/?resume=${cloneId}` } })
      }
      if (url.pathname === '/test-save') {
        title = request.postData() ?? ''
        saves += 1
        return route.fulfill({ body: 'ok' })
      }
      if (url.pathname === `/resume/edit/${cloneId}/position`) return route.fulfill({
        contentType: 'text/html; charset=utf-8', body: `<input data-qa="resume-edit-title-suggest" value="${title}">
          <button onclick="fetch('/test-save',{method:'POST',body:document.querySelector('input').value}).then(()=>location.href='/profile/resume/experience?resume=${cloneId}')">Save</button>`
      })
      if (url.pathname === '/profile/resume') return route.fulfill({
        contentType: 'text/html', body: `<script>location.replace('/profile/resume/experience?resume=${cloneId}')</script>`
      })
      return route.fulfill({ contentType: 'text/html', body: '<div data-qa="resume-profile-screen_experience">Draft</div>' })
    })
    await livePage.goto('https://hh.ru/profile/resume/experience')
    assert.equal(await requestNativeResumeClone(livePage, sourceId, () => undefined), cloneId)
    const source = { id: sourceId, title: 'Baseline', href: `https://hh.ru/resume/${sourceId}`, isDraft: true }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await duplicateResumeVariant(livePage, source, 'Senior Backend Developer',
        'Python', 'En', { duplicateId: cloneId })
      assert.equal(result.id, cloneId)
      assert.equal(result.nativeSourceId, sourceId)
      assert.equal(result.isDraft, true)
    }
    assert.equal(clonePosts, 1, 'Recovery never creates another copy')
    assert.equal(saves, 1, 'Matching title is not written again')
  } finally { await browser.close() }
}
