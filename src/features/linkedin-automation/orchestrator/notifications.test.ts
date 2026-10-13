import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNotifications, createTelegramNoticeSender, formatNotice, remainingToday, noticeCandidate, postReport, notificationConfig } from './notifications.ts'
import type { NoticeReceipt, NoticeStore } from './notifications.ts'
import type { Task, Snapshot, Event } from './contracts.ts'
import { plan } from './planner.ts'

const start = Date.parse('2026-10-13T12:00:00+03:00')
function fixture() {
  let time = start
  const schedule = { account: { id: 105, studentId: 58, name: 'Диана', key: 'li:diana', unipileId: 'a' },
    enabled: true, version: 1, updatedAt: start, slots: [{ id: 'day', day: 1, start: 720, end: 1200,
      features: ['invitations', 'posts', 'comments', 'feed', 'withdrawals'] as Task['feature'][] }] }
  const snapshot: Snapshot = { schedules: [schedule], tasks: plan(schedule, [], start, () => 0) }
  const task = snapshot.tasks.find(t => t.feature === 'invitations')!
  Object.assign(task, { state: 'completed', runId: 'run', summary: { completed: 7, skipped: 0, unconfirmed: 0 }, report: { target: 7 } })
  const sent: string[] = [], events: Event[] = []
  const store: NoticeStore = {
    async owned() {},
    async claimNotice(id, key, receipt) {
      const current = snapshot.tasks.find(t => t.id === id)!, old = current.notices?.[key]
      if (old && (old.status !== 'retry' || (old.nextAt ?? 0) > time)) return false
      ;(current.notices ??= {})[key] = structuredClone(receipt); return true
    },
    async finishNotice(id, key, receipt) { snapshot.tasks.find(t => t.id === id)!.notices![key] = structuredClone(receipt) }
  }
  const options = { store, since: start, chatId: '-100123', now: () => time,
    send: async (text: string) => { sent.push(text); return { status: 'sent' as const, messageId: sent.length } },
    report: (event: Event) => events.push(event) }
  return { snapshot, task, store, sent, events, options, advance(ms = 5000) { time += ms } }
}
async function tick(worker: ReturnType<typeof createNotifications>, snapshot: Snapshot) {
  worker.tick(structuredClone(snapshot), 'owner', 1); await worker.idle()
}

test('report contains actual result, four remaining features, planned time and post dependency', () => {
  const f = fixture(), text = formatNotice(f.task, f.snapshot, start, 'result')
  assert.match(text, /Отправлено приглашений: 7 из 7/)
  assert.match(text, /Осталось на сегодня: 4/)
  assert.match(text, /Публикация — план 13\.10, 14:00/)
  assert.match(text, /Комментарии — первая проверка после подтверждённой публикации/)
  assert.doesNotMatch(text, /Комментарии — план/)
})
test('disabled and finished work excluded; real first check finishes daily count, monitoring remains', () => {
  const f = fixture(), comments = f.snapshot.tasks.find(t => t.feature === 'comments')!
  comments.report = { checkedAt: new Date(start).toISOString() }
  assert.match(remainingToday(f.task, f.snapshot, start), /Осталось на сегодня: 3/)
  assert.match(remainingToday(f.task, f.snapshot, start), /Мониторинг комментариев продолжается/)
  f.snapshot.schedules[0].enabled = false
  assert.match(remainingToday(f.task, f.snapshot, start), /Осталось на сегодня: 0/)
  assert.doesNotMatch(remainingToday(f.task, f.snapshot, start), /продолжается/)
})
test('same run sends once across concurrent ticks and process restart; old results do not flood', async () => {
  const f = fixture(), worker = createNotifications(f.options)
  worker.tick(f.snapshot, 'owner', 1); worker.tick(f.snapshot, 'owner', 1); await worker.idle()
  assert.equal(f.sent.length, 1)
  f.advance(); await tick(createNotifications(f.options), f.snapshot); assert.equal(f.sent.length, 1)
  f.task.updatedAt = start - 1; f.task.notices = {}
  await tick(createNotifications(f.options), f.snapshot); assert.equal(f.sent.length, 1)
})
test('failed receipt save forbids send, and an ambiguous post receipt is never resent after restart', async () => {
  const f = fixture(), claim = f.store.claimNotice
  f.store.claimNotice = async () => { throw Error('SQL') }
  await tick(createNotifications(f.options), f.snapshot); assert.equal(f.sent.length, 0)
  f.store.claimNotice = claim
  f.store.finishNotice = async () => { throw Error('SQL') }
  await tick(createNotifications(f.options), f.snapshot); assert.equal(f.sent.length, 1)
  f.store.finishNotice = async (id, key, receipt) => { f.snapshot.tasks.find(t => t.id === id)!.notices![key] = receipt }
  await tick(createNotifications(f.options), f.snapshot); assert.equal(f.sent.length, 1)
  assert.equal(Object.values(f.task.notices!)[0].status, 'unknown')
  assert.ok(f.events.some(e => e.code === 'telegram_delivery_interrupted'))
})
test('lost lease forbids Telegram POST, leaving uncertain receipt instead of allowing another owner to resend', async () => {
  const f = fixture(); f.store.owned = async () => { throw Error('owner lost') }
  await tick(createNotifications(f.options), f.snapshot); assert.equal(f.sent.length, 0)
  assert.equal(Object.values(f.task.notices!)[0].status, 'sending')
})
test('Telegram wait survives restart and pauses only notifications, then retries the rejected delivery', async () => {
  const f = fixture(); let requests = 0
  const options = { ...f.options, send: async (_: string) => ++requests === 1
    ? { status: 'retry' as const, nextAt: start + 120_000 } : { status: 'sent' as const, messageId: 1 } }
  await tick(createNotifications(options), f.snapshot); assert.equal(requests, 1)
  f.advance(119_000); await tick(createNotifications(options), f.snapshot); assert.equal(requests, 1)
  f.advance(1000); await tick(createNotifications(options), f.snapshot); assert.equal(requests, 2)
  assert.equal(f.task.state, 'completed')
})
test('empty comment polls are quiet; new saved replies notify once per cumulative result', async () => {
  const f = fixture(); f.task.updatedAt--
  const c = f.snapshot.tasks.find(t => t.feature === 'comments')!
  Object.assign(c, { state: 'waiting', report: { checkedAt: new Date(start).toISOString() },
    summary: { completed: 0, skipped: 0, unconfirmed: 0 } })
  await tick(createNotifications(f.options), f.snapshot); assert.equal(f.sent.length, 0)
  c.summary!.completed = 2
  await tick(createNotifications(f.options), f.snapshot); assert.equal(f.sent.length, 1)
  f.advance(); c.report!.checkedAt = new Date(start + 5000).toISOString()
  await tick(createNotifications(f.options), f.snapshot); assert.equal(f.sent.length, 1)
})
test('unknown writes, source, stage and HTTP errors are explicit; provider wait does not promise an exact start', () => {
  const f = fixture(); Object.assign(f.task, { state: 'needs_attention', summary: { completed: 6, skipped: 0, unconfirmed: 1 },
    lastFailure: { source: 'Unipile', code: 'unipile_http_500', httpStatus: 500, stage: 'Проверка отправки', message: 'Результат неизвестен' } })
  const text = formatNotice(f.task, f.snapshot, start, 'result')
  assert.match(text, /Не подтверждено: 1/); assert.match(text, /Этап: Проверка отправки/); assert.match(text, /HTTP 500/)
  f.snapshot.cooldowns = [{ account: f.task.account.key, method: '*', until: start + 8 * 3600_000, code: 'limit', observedAt: start }]
  assert.match(remainingToday(f.task, f.snapshot, start), /Публикация — не раньше 13\.10, 20:00/)
})
test('pause deduplicates deadline; ordinary pacing and repeated empty ticks are silent', () => {
  const f = fixture(); Object.assign(f.task, { state: 'waiting', nextAt: start + 7200_000, reason: 'unipile_429',
    lastFailure: { source: 'Unipile', code: 'unipile_429', httpStatus: 429, message: 'Пауза' } })
  assert.equal(noticeCandidate(f.task, start)?.kind, 'pause')
  assert.equal(noticeCandidate(f.task, start)?.key, noticeCandidate(f.task, start + 10_000)?.key)
  f.task.reason = undefined; assert.equal(noticeCandidate(f.task, start), undefined)
  f.task.lastFailure = undefined; assert.equal(noticeCandidate(f.task, start), undefined)
})

test('yesterday checks and replies do not finish or announce the new daily comment task', () => {
  const f = fixture(), c = f.snapshot.tasks.find(t => t.feature === 'comments')!
  Object.assign(c, { state: 'waiting', report: { checkedAt: new Date(start - 86400_000).toISOString() },
    summary: { completed: 3, skipped: 0, unconfirmed: 0 }, commentBaseline: { runId: 'c', completed: 3, skipped: 0 } })
  assert.equal(noticeCandidate(c, start), undefined)
  assert.match(remainingToday(f.task, f.snapshot, start), /Осталось на сегодня: 4/)
  c.report!.checkedAt = new Date(start).toISOString()
  assert.equal(noticeCandidate(c, start), undefined)
  c.summary!.completed++
  assert.match(formatNotice(c, f.snapshot, start, 'comments'), /Ответов отправлено: 1/)
})

test('configuration supports explicit disable and validates the fixed activation date and group', () => {
  assert.equal(notificationConfig({ LINKEDIN_AUTOMATION_TELEGRAM_ENABLED: '0' }), undefined)
  const env = { LINKEDIN_AUTOMATION_TELEGRAM_CHAT_ID: '-100123', LINKEDIN_AUTOMATION_TELEGRAM_SINCE: new Date(start).toISOString(),
    LINKEDIN_AUTOMATION_TELEGRAM_TOKEN: 'test' }
  assert.equal(notificationConfig(env)?.since, start)
  assert.throws(() => notificationConfig({ ...env, LINKEDIN_AUTOMATION_TELEGRAM_SINCE: '' }), /config_invalid/)
  assert.throws(() => notificationConfig({ ...env, LINKEDIN_AUTOMATION_TELEGRAM_CHAT_ID: '@public' }), /config_invalid/)
})
test('Telegram adapter retries only an explicit 429, never transport errors or ambiguous 500', async () => {
  const send = (response: any) => createTelegramNoticeSender({ chatId: '-100123', now: () => start,
    api: { sendMessageResponse: async () => response } })('report')
  assert.deepEqual(await send({ ok: true, result: { message_id: 7, chat: { id: -100123 } } }), { status: 'sent', messageId: 7 })
  assert.equal((await send({ ok: false, error_code: 403 })).status, 'failed')
  assert.equal((await send({ ok: false, error_code: 500 })).status, 'unknown')
  assert.equal((await send({ ok: false, error_code: 429, parameters: { retry_after: 3600 } })).nextAt, start + 3600_000)
  const broken = createTelegramNoticeSender({ chatId: '-100123', api: { sendMessageResponse: async () => { throw Error('token=secret') } } })
  assert.deepEqual(await broken('report'), { status: 'unknown', code: 'telegram_delivery_unknown' })
})
test('pending likes do not delay publication report; final like summary is sent separately', async () => {
  const f = fixture(); f.task.updatedAt--
  const task = f.snapshot.tasks.find(t => t.feature === 'posts')!
  Object.assign(task, { state: 'completed', runId: 'post', publishedAt: start,
    summary: { completed: 1, skipped: 0, unconfirmed: 0 }, report: { postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1',
      likes: { confirmed: 0, pending: 1, unconfirmed: 0, failed: 0 } } })
  const options = { ...f.options, postReport: async () => ({ likes: { confirmed: 1, pending: 0, unconfirmed: 0, failed: 0 } }) }
  const worker = createNotifications(options)
  await tick(worker, f.snapshot); assert.match(f.sent[0], /Опубликовано постов: 1/); assert.match(f.sent[0], /1 ожидаются/)
  f.advance(); await tick(worker, f.snapshot); assert.match(f.sent[1], /Лайки к посту/)
  f.advance(); await tick(createNotifications(options), f.snapshot); assert.equal(f.sent.length, 2)
  assert.equal(postReport({ engagement: { items: [{ status: 'uncertain', verificationStopped: true }] } } as any)!.likes!.unconfirmed, 1)
})
test('notification network wait does not block caller and close drains the already-started delivery', async () => {
  const f = fixture(); let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const worker = createNotifications({ ...f.options, send: async () => { await pending; return { status: 'sent', messageId: 1 } } })
  assert.equal(worker.tick(f.snapshot, 'owner', 1), undefined)
  await new Promise(resolve => setImmediate(resolve)); release(); await worker.close()
  assert.equal(Object.values(f.task.notices!)[0].status, 'sent')
})
