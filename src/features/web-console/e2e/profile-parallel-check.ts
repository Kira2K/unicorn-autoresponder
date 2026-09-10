import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { desktopProfileJob, profileJobsRoute } from './profile-desktop-fixture.ts'

export async function checkParallelProfiles(page: Page) {
  const prefix = '**/api/admin/linkedin'
  const jobs = new Map<string, ReturnType<typeof desktopProfileJob>>()
  const generations: number[] = [], applies: string[] = []
  const errors: string[] = []
  const onError = (error: Error) => errors.push(error.message)
  page.on('pageerror', onError)
  const listRoute = profileJobsRoute, detailRoute = `${prefix}/profile-jobs/parallel-*`
  const generateRoute = `${prefix}/accounts/*/profile-generations`, applyRoute = `${detailRoute}/apply`
  await page.route(listRoute, route => {
    const id = Number(new URL(route.request().url()).searchParams.get('platformAccountId'))
    return route.fulfill({ json: { jobs: [...jobs.values()].filter(job => job.platformAccountId === id) } })
  })
  await page.route(detailRoute, route => route.fulfill({ json: jobs.get(route.request().url().split('/').pop()!) }))
  await page.route(generateRoute, route => {
    const id = Number(route.request().url().split('/').at(-2))
    generations.push(id)
    const job = { ...desktopProfileJob(), jobId: `parallel-${id}`, platformAccountId: id,
      planHash: `hash-${id}`, clientName: `Fixture ${id}` }
    jobs.set(job.jobId, job)
    return route.fulfill({ json: job })
  })
  await page.route(applyRoute, route => {
    const id = route.request().url().split('/').at(-2)!
    const job = jobs.get(id)!
    assert.equal(route.request().postDataJSON().planHash, job.planHash)
    applies.push(id)
    job.status = 'verifying'
    job.result = { status: 'verifying', startedAt: new Date().toISOString(),
      steps: job.preview.steps.map(step => ({ stepId: step.id,
      section: step.section, status: 'verifying', message: 'Read-back',
      nextActionAt: new Date(Date.now() + 120000).toISOString() })) }
    return route.fulfill({ json: job })
  })
  async function close() {
    await page.getByTestId('profile-filler-close').click()
    await page.locator('.profile-filler-dialog').waitFor({ state: 'hidden' })
  }
  async function reload() {
    await page.reload()
    await page.getByTestId('admin-dashboard').waitFor()
    await page.getByTestId('admin-linkedin-tab').click()
  }
  try {
    await reload()
    for (const id of [203, 103]) {
      assert.equal(await page.getByTestId(`profile-filler-${id}`).isEnabled(), true)
      await page.getByTestId(`profile-filler-${id}`).click()
      await page.getByTestId('profile-filler-generate').click()
      await page.getByTestId('profile-filler-apply').click()
      await page.getByTestId('profile-confirm-submit').evaluate(element => {
        (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click()
      })
      await page.getByTestId('profile-progress').waitFor()
      await close()
    }
    for (const id of [203, 103]) await page.getByTestId(`profile-filler-${id}`).getByText('Открыть прогресс').waitFor()
    await reload()
    for (const id of [203, 103]) {
      await page.getByTestId(`profile-filler-${id}`).click()
      await page.getByTestId('profile-progress').waitFor()
      assert.equal(await page.getByTestId('profile-filler-apply').count(), 0)
      await close()
    }
    const first = jobs.get('parallel-203')!
    first.status = 'succeeded'; first.phase = 'completed_verified'; first.result!.status = 'verified'
    first.result!.steps.forEach(step => { step.status = 'verified' })
    await page.getByTestId('profile-filler-203').click()
    await page.getByTestId('profile-result-title').getByText('Профиль заполнен и проверен', { exact: true }).waitFor()
    await close()
    const second = jobs.get('parallel-103')!
    assert.equal(second.status, 'verifying')
    await page.getByTestId('profile-filler-103').getByText('Открыть прогресс').waitFor()
    second.status = 'needs_expert_review'; second.phase = 'verification_failed'
    second.result!.status = 'failed'; second.result!.steps[0].status = 'failed'
    await page.getByTestId('profile-filler-103').click()
    await page.getByTestId('profile-result-title').getByText('Нужна проверка', { exact: true }).waitFor()
    assert.deepEqual(generations, [203, 103])
    assert.deepEqual(applies, ['parallel-203', 'parallel-103'])
    assert.deepEqual(errors, [])
  } finally {
    page.off('pageerror', onError)
    for (const route of [listRoute, detailRoute, generateRoute, applyRoute]) await page.unroute(route)
  }
}
