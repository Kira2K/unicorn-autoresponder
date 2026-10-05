import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { prepareLinkedInAutomation } from '../backend/linkedin-automation.ts'
import type { Store, Schedule, Task, Event } from '../../linkedin-automation/orchestrator/contracts.ts'
const require = createRequire(import.meta.url)
const { createWebConsoleApp } = require('../backend/app.ts')
const { createMockLinkedInAuthRunService } = require('../backend/linkedin-auth-mock.ts')
const { createMockPostWriter } = require('../../linkedin-automation/post-writer/mock.ts')
const { createMockConnectionInviterService } = require('../backend/connection-inviter-mock.ts')

// Real admin routes and runtime; only storage/provider dependencies are in memory.
const at = Date.now(), auth = createMockLinkedInAuthRunService(), schedules: Schedule[] = [], tasks: Task[] = []
const events: Event[] = Array.from({ length: 210 }, (_, i) => ({ id: i + 1, at: at - (210 - i) * 60_000,
  accountId: 203, studentId: 2, feature: 'invitations', source: 'Unipile', code: i === 209 ? 'unipile_rate_limit' : 'request_succeeded',
  message: i === 209 ? 'Провайдер ограничил запросы. Срок ожидания сохранён.' : 'Запрос выполнен.',
  httpStatus: i === 209 ? 429 : 200, nextAt: i === 209 ? at + 3600_000 : undefined,
  diagnostic: i === 209 ? 'Error (unipile_rate_limit): src/integrations/unipile/http-client.ts:1:1' : undefined,
  ...(i === 209 ? { runId: 'trace-run', actionId: 'trace-action', requestId: 'trace-request', version: 'test-source', initiator: 'schedule' } : {}) }))
let owner: string | undefined, dbUp = true, providerUntil = 0
const check = () => { if (!dbUp) throw Object.assign(Error('db unavailable'), { code: 'sql_unavailable' }) }
const copy = <T,>(value: T): T => structuredClone(value)
const store: Store = {
  async ready() { return true }, async snapshot() { check(); return copy({ schedules, tasks, owner: { id: owner!, epoch: 1, until: Date.now() + 45_000 } }) },
  async schedule(value, version) {
    check(); const index = schedules.findIndex(s => s.account.id === value.account.id)
    if ((schedules[index]?.version ?? 0) !== version) throw Object.assign(Error('conflict'), { code: 'automation_version_conflict' })
    const next = copy({ ...value, version: version + 1 }); if (index < 0) schedules.push(next); else schedules[index] = next
    return copy(next)
  },
  async create(values) { check(); for (const value of values) if (!tasks.some(t => t.id === value.id)) tasks.push(copy(value)) },
  async save(value, event) { check(); const index = tasks.findIndex(t => t.id === value.id), next = copy({ ...value, version: value.version + 1 })
    tasks[index] = next; events.push({ ...copy(event), id: events.length + 1 }); return copy(next) },
  async history(account, after = 0, limit = 200, filter = {}) { check(); const rows = events.filter(e => (!account || e.accountId === account) && e.id! > after &&
    (!filter.before || e.id! < filter.before) && (!filter.source || e.source === filter.source) && (!filter.feature || e.feature === filter.feature) &&
    (!filter.errorsOnly || Number(e.httpStatus) >= 400) && (!filter.from || e.at >= filter.from) && (!filter.to || e.at < filter.to))
    return copy((filter.latest ? rows.reverse() : rows).slice(0, limit)) },
  async durations() { return [] }, async claim(id) { check(); owner = id; return 1 }, async owned() { check() }, async release() { owner = undefined },
  async cooldown() { check() }, async blockedUntil(_account, method) { return method === 'action' ? 0 : providerUntil }, async event(e) { check(); events.push({ ...copy(e), id: events.length + 1 }) }, async pruneLogs() {}
}
const sqlStore = { ...store, withdrawals: { async load() { return undefined }, async save() {} }, async importWithdrawal() {} }
const automation = (await prepareLinkedInAutomation(sqlStore as any, { listAccounts: () => auth.listAccounts() }, { autoStart: false }))!
const posts = createMockPostWriter(automation.gate)
const inviter = Object.assign(createMockConnectionInviterService(), { stop() {} })
const backend = createWebConsoleApp({ useMockData: true, linkedinAuthRuns: auth, linkedinAutomation: automation, postWriter: posts, connectionInviter: inviter }).listen(0, '127.0.0.1')
await new Promise(resolve => backend.once('listening', resolve))
const previousApi = process.env.WEB_CONSOLE_API_URL
process.env.WEB_CONSOLE_API_URL = `http://127.0.0.1:${backend.address().port}`
const frontend = await createServer({ configFile: resolve('src/features/web-console/frontend/vite.config.js'), server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' })
const originalFetch = globalThis.fetch
globalThis.fetch = (input, options) => {
  const url = new URL(String(input instanceof Request ? input.url : input))
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw Error('External network forbidden in mock E2E')
  return originalFetch(input, options)
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  await automation.tick(); await frontend.listen(); await mkdir('.codex-tmp', { recursive: true })
  browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1500, height: 1080 } })
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  const url = `http://127.0.0.1:${(frontend.httpServer!.address() as import('node:net').AddressInfo).port}`
  assert.equal((await page.request.get(`${url}/api/admin/linkedin/automation`)).status(), 401)
  await page.goto(url); await page.getByTestId('email-input').fill('unicornveryevil@gmail.com')
  await page.locator('input[type="password"]').fill('101010'); await page.getByTestId('login-button').click()
  await page.getByTestId('admin-linkedin-tab').click(); await page.getByText('Исполнитель на связи', { exact: true }).waitFor()
  await page.getByTestId('linkedin-student-203').click(); await page.getByTestId('linkedin-detail-schedule').click()
  await page.getByTestId('automation-enabled').check(); await page.getByTestId('automation-add').click()
  await page.getByTestId('automation-end').fill('12')
  assert.equal(await page.getByTestId('automation-save').isDisabled(), true)
  assert.match(await page.getByTestId('automation-validation').innerText(), /полное время/)
    await page.getByTestId('automation-end').fill('24:00'); await page.getByTestId('automation-feature-posts').check()
    assert.equal(await page.getByTestId('automation-save').isDisabled(), true)
    await page.getByTestId('automation-post-source').selectOption('prepared')
    await page.getByTestId('automation-post-fallback').check()
  await page.getByTestId('automation-add').click(); assert.match(await page.getByTestId('automation-validation').innerText(), /Пересекаются/)
  await page.getByRole('button', { name: 'Удалить интервал' }).last().click()
  await page.getByTestId('automation-preview').click(); await page.getByTestId('automation-preview-result').waitFor()
  assert.equal(schedules.length, 0); assert.equal(tasks.length, 0)
  await page.getByTestId('automation-save').click(); await page.getByTestId('automation-confirm').click()
  await page.getByText('Расписание сохранено.', { exact: true }).waitFor()
  assert.equal(schedules[0].enabled, true); assert.equal((await posts.get(203)).settings.automationManaged, true)
  assert.equal((await posts.get(203)).runs.length, 0)
  await page.getByRole('button', { name: 'Копировать день', exact: true }).click()
  await page.locator('.copy-box').getByLabel('Вт', { exact: true }).check()
  await page.getByRole('button', { name: 'Заменить выбранные дни' }).click()
  await page.getByTestId('automation-save').click(); await page.getByTestId('automation-confirm').click()
  await page.waitForFunction(() => document.querySelector('[data-testid="automation-day-1"] small')?.textContent === '1')
  await page.getByTestId('automation-save').waitFor({ state: 'visible' })
  await page.screenshot({ path: '.codex-tmp/automation-calendar.png', fullPage: true })

  // Concurrent edits preserve the local draft and reject stale versions.
  await page.getByTestId('automation-end').fill('23:00')
  schedules[0].version++
  await page.getByRole('button', { name: 'Обновить статус' }).click()
  await page.getByTestId('automation-reload-draft').waitFor()
  assert.equal(await page.getByTestId('automation-end').inputValue(), '23:00')
  assert.equal(await page.getByTestId('automation-save').isDisabled(), true)
  await page.getByTestId('automation-reload-draft').click()
  assert.equal(await page.getByTestId('automation-end').inputValue(), '24:00')
  await page.getByRole('button', { name: 'Свернуть карточку' }).click()
  page.once('dialog', dialog => void dialog.dismiss())
  await page.getByTestId('automation-toggle-203').click()
  assert.equal(schedules[0].enabled, true); assert.equal(await page.getByTestId('automation-toggle-203').isChecked(), true)

  // Bulk apply uses captured versions and reports each student, never silently skips errors.
  await page.getByTestId('automation-select-203').check(); await page.getByTestId('automation-select-103').check()
  await page.getByTestId('automation-bulk').click(); await page.getByTestId('automation-add').click()
  await page.getByTestId('automation-save').click(); await page.getByTestId('automation-confirm').click()
  await page.getByTestId('automation-apply-results').waitFor()
  assert.match(await page.getByTestId('automation-apply-results').innerText(), /Connected Client.*Сохранено/)
  assert.match(await page.getByTestId('automation-apply-results').innerText(), /Test Client.*подключите/)
  page.once('dialog', dialog => void dialog.accept()); await page.getByRole('button', { name: 'Свернуть карточку' }).click()
  assert.equal(schedules.length, 1); assert.equal(schedules[0].enabled, false)

  // Derived waits explain the actual next action without rewriting the saved plan.
  tasks.push({ id: 'waiting-proof', account: schedules[0].account, feature: 'invitations', state: 'verifying',
    stopped: true, nextAt: at, plannedAt: at, stageMessage: 'Сверяем отправленное приглашение.' } as Task)
  providerUntil = at + 2 * 3600_000
  await page.getByRole('button', { name: 'Обновить статус' }).click()
  await page.getByTestId('linkedin-student-203').click(); await page.getByTestId('linkedin-detail-status').click()
  await page.locator('details.task summary').click()
  await page.getByText('Новые действия остановлены. Проверяем уже отправленное.').waitFor()
  await page.getByText('Сверяем отправленное приглашение.').waitFor()
  assert.match(await page.locator('details.task').innerText(), /Ожидаем снятия ограничения Unipile/)
  assert.equal(tasks[0].nextAt, at); assert.equal(tasks[0].plannedAt, at)
  const getPosts = posts.get
  posts.get = async (account: number) => ({ ...await getPosts(account), runs: [{ id: 'published-with-pending-likes',
    publishedAt: at, engagement: { status: 'uncertain', target: 3,
      items: [{ status: 'sent' }, { status: 'uncertain' }, { status: 'pending' }] } } as any] })
  tasks.push({ id: 'post-proof', account: schedules[0].account, feature: 'posts', state: 'completed',
    runId: 'published-with-pending-likes', updatedAt: at } as Task)
  await page.getByRole('button', { name: 'Обновить статус' }).click()
  await page.locator('details.task').filter({ hasText: 'Посты' }).locator('summary').click()
  const postCard = page.locator('details.task').filter({ hasText: 'Посты' })
  assert.match(await postCard.innerText(), /Пост опубликован/)
  assert.match(await postCard.innerText(), /подтверждено 1 из 3[\s\S]*Ожидают отправки: 1; проверки: 1/)
  posts.get = getPosts
  tasks.length = 0; providerUntil = 0
  await page.getByRole('button', { name: 'Свернуть карточку' }).click()

  // History: server-side filters, old page, readable deadline, collapsible details.
  await page.getByTestId('automation-history-tab').click(); await page.getByTestId('automation-event').first().waitFor()
  assert.equal(await page.getByTestId('automation-event').count(), 200)
  await page.getByTestId('automation-log-more').click(); await page.getByTestId('automation-log-more').waitFor({ state: 'hidden' })
  assert.equal(await page.getByTestId('automation-event').count(), 210)
  await page.getByTestId('automation-log-errors').check()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="automation-event"]').length === 1)
  await page.getByTestId('automation-event').locator('summary').click()
  assert.match(await page.getByTestId('automation-event').innerText(), /429/)
  assert.match(await page.getByTestId('automation-event').innerText(), /Следующая проверка/)
  assert.match(await page.getByTestId('automation-event').locator('pre').innerText(), /http-client.ts:1:1/)
  assert.match(await page.getByTestId('automation-event').innerText(), /trace-run[\s\S]*trace-action[\s\S]*По расписанию/)
  Object.assign(events[209], { feature: 'posts', code: 'unipile_http_500', httpStatus: 500,
    operation: 'GET posts', stage: 'Проверка постов', message: 'Проверка постов. HTTP 500. Internal server error.',
    diagnostic: 'Error (unipile_http_500): src/integrations/unipile/http-client.ts:1:1' })
  await page.getByRole('button', { name: 'Обновить журнал', exact: true }).click()
  await page.getByText('Проверка постов. HTTP 500. Internal server error.', { exact: true }).waitFor()
  const logged = page.getByTestId('automation-event')
  if (!(await logged.evaluate(element => element.hasAttribute('open')))) await logged.locator('summary').click()
  assert.match(await logged.innerText(), /Этап[\s\S]*Проверка постов/)
  assert.match(await logged.innerText(), /HTTP[\s\S]*500/)
  assert.match(await logged.innerText(), /Unipile[\s\S]*trace-run[\s\S]*trace-action[\s\S]*trace-request/)
  await page.screenshot({ path: '.codex-tmp/automation-log.png', fullPage: true })
  await page.getByTestId('automation-log-source').selectOption('SQL'); await page.getByText('Событий по этим условиям нет.').waitFor()

  await page.getByRole('button', { name: 'Ученики', exact: true }).click()
  // Failed SQL does not erase the account list or present an empty list as success.
  dbUp = false; await page.getByRole('button', { name: 'Обновить статус' }).click()
  await page.getByTestId('automation-runtime-status').filter({ hasText: /состояни/ }).waitFor()
  assert.equal(await page.getByTestId('linkedin-student-203').count(), 1)
  assert.equal(await page.getByTestId('automation-toggle-203').isDisabled(), true)
  dbUp = true; await page.getByRole('button', { name: 'Обновить статус' }).click()
  await page.getByText('Исполнитель на связи', { exact: true }).waitFor()

  // Existing manual services remain reachable; selected likers are saved through the real service.
  await page.getByTestId('linkedin-student-203').click(); await page.getByTestId('linkedin-detail-manual').click()
  await page.getByTestId('post-writer-203').click(); await page.getByTestId('post-likes').check()
  assert.equal(await page.getByTestId('post-save').isDisabled(), true)
  await page.getByTestId('post-like-account-901').check(); await page.getByTestId('post-save').click()
  await page.waitForResponse(r => r.url().endsWith('/post-writer') && r.status() === 200)
  assert.deepEqual((await posts.get(203)).settings.likeAccountIds, [901])
  assert.equal(await page.getByTestId('post-scheduled').count(), 0)
  await page.getByTestId('post-writer-dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByTestId('withdrawal-open-203').click(); await page.getByTestId('withdrawal-load').click()
  await page.getByTestId('withdrawal-list').waitFor(); await page.getByTestId('withdrawal-minimize').click()
  assert.equal(await page.getByTestId('connection-inviter-203').count(), 1)
  assert.equal(await page.getByTestId('comment-monitor-203').count(), 1)
  await page.getByTestId('linkedin-detail-status').click()
  schedules[0].enabled = true
  tasks.push({ id: 'resumable', account: schedules[0].account, state: 'needs_attention', feature: 'invitations',
    reason: 'connection_inviter_stack_required', updatedAt: at, version: 0,
    day: new Date(at + 3 * 3600_000).toISOString().slice(0, 10), activeMs: 0, activeLimitMs: 3600_000 } as Task)
  await page.getByRole('button', { name: 'Обновить статус' }).click(); await page.getByTestId('automation-resume').click()
  await page.getByText('Продолжение разрешено. Сохранённые отправки не повторяются.').waitFor()
  assert.equal(tasks[0].state, 'waiting'); assert.equal(tasks[0].id, 'resumable')
  schedules[0].slots[0].features = ['invitations', 'posts', 'comments', 'withdrawals']
  for (const feature of schedules[0].slots[0].features) tasks.push({ ...copy(tasks[0]),
    id: `stopped-${feature}`, feature, state: 'stopped', stopped: true, runId: `saved-${feature}` })
  tasks.push({ ...copy(tasks[0]), id: 'completed-post', feature: 'posts', state: 'completed' })
  await page.getByRole('button', { name: 'Обновить статус' }).click()
  await page.getByTestId('automation-resume-all').click()
  await page.getByText('Продолжено задач: 4. Очередь, квоты и паузы сохранены.').waitFor()
  assert.ok(tasks.filter(task => task.id.startsWith('stopped-')).every(task =>
    task.state === 'waiting' && task.retryRequested && !task.stopped && task.runId === `saved-${task.feature}`))
  assert.equal(tasks.find(task => task.id === 'completed-post')?.state, 'completed')
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByTestId('linkedin-detail-schedule').click()
  // Clearing is explicit, scoped to this student, and preserves history and the draft on failure.
  const beforeClear = copy(schedules[0]), taskHistory = copy(tasks), eventHistory = copy(events)
  const otherSchedule = copy({ ...beforeClear, account: { ...beforeClear.account, id: 103 }, version: 8 })
  schedules.push(otherSchedule)
  await page.getByTestId('automation-clear').waitFor({ timeout: 3000 })
  await page.getByTestId('automation-clear').click()
  const clearing = page.getByRole('alertdialog', { name: 'Очистить расписание' })
  await clearing.waitFor(); assert.deepEqual(schedules[0], beforeClear)
  await clearing.getByRole('button', { name: 'Отмена', exact: true }).click()
  assert.deepEqual(schedules[0], beforeClear)
  assert.equal(await page.getByTestId('automation-enabled').isChecked(), true)
  const clearUrl = '**/api/admin/linkedin/automation/schedule/203'
  await page.route(clearUrl, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'sql_unavailable' }) }))
  await page.getByTestId('automation-clear').click(); await clearing.getByTestId('automation-confirm').click()
  await page.getByTestId('automation-calendar').getByRole('alert').filter({ hasText: 'Нет доступа' }).waitFor()
  assert.deepEqual(schedules[0], beforeClear)
  assert.equal(await page.getByTestId('automation-enabled').isChecked(), true)
  await page.unroute(clearUrl)
  await page.getByTestId('automation-clear').click(); await clearing.getByTestId('automation-confirm').click()
  await page.waitForFunction(() => document.querySelector('[data-testid="automation-clear"]')?.hasAttribute('disabled'))
  assert.equal(schedules[0].enabled, false); assert.deepEqual(schedules[0].slots, [])
  assert.deepEqual(schedules[0].postPolicy, beforeClear.postPolicy)
  assert.deepEqual(schedules[1], otherSchedule); assert.deepEqual(tasks, taskHistory); assert.deepEqual(events, eventHistory)
  await page.getByTestId('linkedin-detail-status').click(); await page.getByTestId('linkedin-detail-schedule').click()
  assert.equal(await page.getByTestId('automation-enabled').isChecked(), false)
  assert.equal(await page.getByTestId('automation-slot').count(), 0)
  await page.screenshot({ path: '.codex-tmp/automation-mobile.png', fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  assert.deepEqual(errors, [])
  console.log('Automation browser E2E passed: calendar, preview, conflict, bulk partial result, history pages/filter, SQL outage, manual entrypoints, selected likes, resume, clear schedule and mobile.')
} finally {
  globalThis.fetch = originalFetch
  await browser?.close(); await frontend.close(); await automation.close()
  await new Promise<void>(resolve => backend.close(() => resolve()))
  if (previousApi === undefined) delete process.env.WEB_CONSOLE_API_URL; else process.env.WEB_CONSOLE_API_URL = previousApi
}
