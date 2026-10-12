import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readWorkable } from '../vacancy_collection/workable-reader.ts'
import { vacancyLinks } from '../vacancy_collection/navigation.ts'

const fixture = async (name: string) => JSON.parse(await readFile(new URL(`./fixtures/workable/${name.includes('jobs')?'jobs':'empty'}.json`, import.meta.url), 'utf8'))
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

test('public ATS navigation excludes vendor careers and privacy controls while keeping employer jobs', () => {
  const base='https://upstart13.teamtailor.com/'
  const urls=['https://career.teamtailor.com/jobs','https://app.teamtailor.com/',base+'sso_login',base+'cookie-policy',base+'data-privacy',base+'jobs']
  assert.deepEqual(vacancyLinks(urls.map(url=>({url,text:'Jobs'})),base).map(l=>l.url),[base+'jobs'])
})

test('Workable public fixture yields complete employer-bound jobs with readable bodies and actual URLs', async () => {
  const data = await fixture('workable-jobs-fixture.json')
  const calls: { url: string; init?: RequestInit }[] = []
  const page = await readWorkable('https://apply.workable.com/zeptolab/', async (input, init) => {
    calls.push({ url: String(input), init }); return reply(data)
  })
  assert.equal(calls[0].url, 'https://apply.workable.com/api/v1/widget/accounts/zeptolab?details=true')
  assert.equal(calls[0].init?.redirect, 'error')
  assert.equal(page?.completeListing, true)
  assert.equal(page?.partial, false)
  assert.equal(page?.jobs.length, 3)
  assert.equal(page?.jobs[0].company, 'ZeptoLab')
  assert.equal(page?.jobs[0].url, data.jobs[0].url)
  assert.equal(page?.jobs[0].applyUrl, data.jobs[0].application_url)
  assert.match(page!.jobs[0].description, /What we're looking for/)
  assert.match(page!.jobs[0].location, /United Kingdom.*Cyprus.*Georgia.*Remote/)
  assert.equal(page?.jobs[2].publishedAt, '2023-03-30')
  assert.notEqual(page?.jobs[2].publishedAt, data.jobs[2].created_at)
})

test('only a scoped employer detail path filters the public feed', async () => {
  const data = await fixture('workable-jobs-fixture.json')
  const page = await readWorkable('https://apply.workable.com/zeptolab/j/82f3707c95', async () => reply(data))
  assert.deepEqual(page?.jobs.map(job => job.title), ['Generalist Artist'])
  assert.equal(page?.completeListing, false)
  assert.equal(page?.explicitlyEmpty, false)
  assert.equal(page?.partial, false)

  let calls = 0
  const fetcher = async () => { calls++; return reply(data) }
  assert.equal(await readWorkable('https://apply.workable.com/j/82F3707C95', fetcher), undefined)
  assert.equal(await readWorkable('https://apply.workable.com/backend/accounts/zeptolab', fetcher), undefined)
  assert.equal(await readWorkable('https://www.workable.com/zeptolab', fetcher), undefined)
  assert.equal(await readWorkable('https://apply.workable.com/login', fetcher), undefined)
  assert.equal(calls, 0)
})

test('only a validated empty jobs array is explicitly empty', async () => {
  const data = await fixture('workable-fixture.json')
  const page = await readWorkable('https://apply.workable.com/virtuozzo', async () => reply(data))
  assert.equal(page?.explicitlyEmpty, true)
  assert.equal(page?.completeListing, true)
  assert.equal(page?.partial, false)
  await assert.rejects(readWorkable('https://apply.workable.com/broken', async () => reply({ name: 'Broken' })), /validated jobs list/)
  await assert.rejects(readWorkable('https://apply.workable.com/broken', async () => reply({ jobs: {} })), /validated jobs list/)
})

test('malformed IDs, foreign destinations, duplicates, and missing bodies keep the listing partial', async () => {
  const body = '<p>Responsibilities: build reliable backend services.</p><p>Requirements: production engineering experience.</p>'
  const row = (shortcode: string, changes: Record<string, unknown> = {}) => ({ title: `Role ${shortcode}`, shortcode, url: `https://apply.workable.com/j/${shortcode}`, application_url: `https://apply.workable.com/j/${shortcode}/apply`, description: body, published_on: '2026-09-01', created_at: '2020-01-01', ...changes })
  const page = await readWorkable('https://apply.workable.com/safe-org', async () => reply({ name: 'Safe', jobs: [
    row('A1'), row('BAD-ID'), row('B2', { url: 'https://evil.example/j/B2' }), row('C3'), row('C3'), row('D4', { description: '' })
  ] }))
  assert.deepEqual(page?.jobs.map(job => job.url), ['https://apply.workable.com/j/A1', 'https://apply.workable.com/j/D4'])
  assert.equal(page?.jobs[0].publishedAt, '2026-09-01')
  assert.equal(page?.partial, true)
  assert.equal(page?.completeListing, false)
  assert.equal(page?.explicitlyEmpty, false)
})

test('requirements and benefits fields are included and HTTP failures stay explicit', async () => {
  const page = await readWorkable('https://apply.workable.com/acme', async () => reply({ name: 'Acme', jobs: [{
    title: 'Backend Engineer', shortcode: 'AB12', url: 'https://apply.workable.com/acme/j/AB12', application_url: 'https://apply.workable.com/acme/j/AB12/apply',
    description: '<p>Build services for our customers.</p>', requirements: '<p>Requirements: TypeScript and PostgreSQL.</p>', benefits: '<p>Benefits: flexible remote work and health cover.</p>'
  }] }))
  assert.match(page!.jobs[0].description, /Requirements: TypeScript/)
  assert.match(page!.jobs[0].description, /Benefits: flexible remote work/)
  await assert.rejects(readWorkable('https://apply.workable.com/acme', async () => reply({}, 302)), /HTTP 302/)
})
