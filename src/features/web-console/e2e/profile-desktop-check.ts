import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { desktopProfileJob, profileJobsRoute } from './profile-desktop-fixture.ts'
import { checkProfileLayout } from './profile-desktop-layout.ts'
import { checkProfileRunning } from './profile-desktop-running.ts'

export async function checkProfileDesktop(page: Page) {
  const job = desktopProfileJob()
  const old = { ...desktopProfileJob(), jobId: 'desktop-old', status: 'succeeded' }
  let generated = false
  let generations = 0
  let applies = 0
  let reads = 0
  const browserErrors: string[] = []
  const onError = (error: Error) => browserErrors.push(error.message)
  page.on('pageerror', onError)
  const generationRoute = '**/api/admin/linkedin/accounts/203/profile-generations'
  await page.route(profileJobsRoute, route => route.fulfill({ json: { jobs: generated ? [job, old] : [] } }))
  await page.route(`${profileJobsRoute}/desktop-ui`, route => { reads += 1; return route.fulfill({ json: job }) })
  await page.route(`${profileJobsRoute}/desktop-old`, route => route.fulfill({ json: old }))
  await page.route(generationRoute, async route => {
    generations += 1
    assert.equal(route.request().headers()['content-type'], 'application/pdf')
    await new Promise(resolve => setTimeout(resolve, 250))
    if (generations === 1) return route.fulfill({ status: 503, json: { error: 'openai_service_unavailable' } })
    generated = true
    await route.fulfill({ json: job })
  })
  await page.route(`${profileJobsRoute}/desktop-ui/apply`, async route => {
    applies += 1
    assert.equal(route.request().postDataJSON().planHash, 'desktop-approved-plan')
    job.status = 'verifying'
    job.result = { status: 'verifying', startedAt: new Date().toISOString(), steps: job.preview.steps.map(step => ({
      stepId: step.id, section: step.section, status: 'verifying', message: 'Mock read-back',
      nextActionAt: new Date(Date.now() + 120000).toISOString() })) }
    await route.fulfill({ json: job })
  })
  try {
    await page.reload()
    await page.getByTestId('admin-dashboard').waitFor()
    await page.getByTestId('admin-linkedin-tab').click()
    await page.getByTestId('profile-filler-203').click()
    await page.getByTestId('profile-source-upload').check()
    await page.getByTestId('profile-filler-cv-file').setInputFiles({ name: 'approved-en-cv.pdf',
      mimeType: 'application/pdf', buffer: Buffer.from('%PDF mock fixture') })
    assert.equal(generations, 0, 'file selection cannot generate')
    const generate = page.getByTestId('profile-filler-generate')
    await generate.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click() })
    await page.getByTestId('profile-ui-error').waitFor()
    assert.equal(generations, 1)
    assert.match(await page.getByTestId('profile-cv-selected').innerText(), /approved-en-cv.pdf/)
    await generate.click()
    await page.getByTestId('profile-filler-apply').waitFor()
    assert.equal(generations, 2)
    assert.equal(await page.getByTestId('profile-draft-editor').count(), 0)
    assert.match(await page.getByTestId('profile-skills-summary').innerText(), /42 сохраняем \+ 58 добавляем = 100/)
    await checkProfileLayout(page)
    assert.equal(applies, 0, 'dismissing confirmation cannot Apply')
    await checkProfileRunning(page, job, () => reads)
    assert.equal(applies, 1)
    assert.deepEqual(browserErrors, [])
  } finally {
    page.off('pageerror', onError)
    for (const suffix of ['', '/desktop-ui', '/desktop-old', '/desktop-ui/apply']) await page.unroute(`${profileJobsRoute}${suffix}`)
    await page.unroute(generationRoute)
  }
}
