import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { descriptionMarket } from '../vacancy_collection/description-market.ts'
import { applicationDestinations, telegramOnly } from '../vacancy_collection/application-destinations.ts'
import { createSourceReviewStore } from '../vacancy_collection/source-reviews.ts'
import { createWebsiteStrategy } from '../vacancy_collection/discover.ts'
import { collectVacancies } from '../vacancy_collection/index.ts'
import { classifyVacancies, assertCollectionReady } from '../stack_classification/index.ts'
import { generateCollectionReport } from '../reporting/collection.ts'
import { validateApplicationSelection } from '../applications/index.ts'
import type { Source, Position } from '../types.ts'

const source: Source = { name: 'Example', url: 'https://example.test/jobs', database: { companyId: '1', sourceId: '1', applicationRoute: 'standard_workflow' } }
const position: Position = { id: '', company: source.name, title: 'Senior Java Engineer', description: 'Java Spring backend. Send your CV in Telegram to @hiring_team.', location: '', source, url: source.url + '/1', applyUrl: source.url + '/1', retrievedAt: '2026-09-28T00:00:00Z' }

test('market requires vacancy language evidence rather than a company default', () => {
  assert.equal(descriptionMarket('We are looking for a developer to work with our team and build services.').value, 'global')
  assert.equal(descriptionMarket('Мы ищем разработчика. Вы будете работать в нашей команде. Нужен опыт работы и разработки сервисов.').value, 'ru')
  assert.equal(descriptionMarket('').value, 'unknown')
})

test('explicit Telegram application instructions survive; social links and email handles do not become destinations', () => {
  const routes = applicationDestinations(position)
  assert.deepEqual(routes.map(r => r.address), ['https://t.me/hiring_team'])
  assert.equal(telegramOnly({ ...position, applicationDestinations: routes }), true)
  assert.deepEqual(applicationDestinations({ ...position, description: 'Follow our Telegram community @community. Send CV to jobs@example.org.' }), [])
  const linked = applicationDestinations({ ...position, description: 'Send CV using Telegram.', applicationLinks: [{ url: 'https://t.me/recruiter', text: 'Send CV using Telegram' }] })
  assert.equal(linked[0].address, 'https://t.me/recruiter')
  assert.equal(applicationDestinations({ ...position, description: 'Apply to @hiring_team', applyUrl: 'https://forms.test/apply' }).length, 2)
})

test('registration creates a durable review, pauses that source across runs and continues other sources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'external-reviews-'))
  try {
    let reads = 0
    const sources = [source, { ...source, name: 'Second', url: 'https://second.test/jobs', database: { ...source.database!, companyId: '2', sourceId: '2' } }]
    const reader = { read: async (url: string) => { reads++; return url === source.url
      ? { url, text: 'Register to view jobs', jobs: [], links: [], accessGate: { kind: 'registration_required' as const, url, evidence: 'Register to view jobs' } }
      : { url, text: 'No open jobs', jobs: [], links: [] } } }
    const first = await collectVacancies({ runId: 'first', sources }, { strategy: createWebsiteStrategy({ reader, reviews: createSourceReviewStore(directory) }) })
    assert.equal(first.audit[0].accessGate?.kind, 'registration_required')
    assert.equal(first.audit[1].status, 'complete')
    const pending = await createSourceReviewStore(directory).pending(source)
    assert.equal(pending?.evidence, 'Register to view jobs')
    await collectVacancies({ runId: 'second', sources }, { strategy: createWebsiteStrategy({ reader, reviews: createSourceReviewStore(directory) }) })
    assert.equal(reads, 3)
    await createSourceReviewStore(directory).resolve(source)
    assert.equal(await createSourceReviewStore(directory).pending(source), undefined)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('partial source retains complete roles; report counts companies once and Telegram as deferred work', async () => {
  const second = { ...source, url: 'https://example.test/careers', database: { ...source.database!, sourceId: '2' } }
  const routes = applicationDestinations(position)
  const collection = await collectVacancies({ runId: 'partial', sources: [source, second] }, { strategy: { name: 'fixture', discover: async () => ({
    positions: [{ ...position, applicationDestinations: routes }],
    audit: [{ source, status: 'partial', pages: [source.url], found: 1, issues: ['Page 5 unavailable'] }, { source: second, status: 'unavailable', pages: [], found: 0, issues: ['HTTP 503'] }]
  }) } })
  const classified = await classifyVacancies({ collection, stacks: [{ id: 'java', name: 'Java', description: 'Java Spring backend' }] }, { assess: async () => ({ decision: 'eligible', reasons: ['Backend Java'], evidence: ['Java Spring'] }) })
  assert.equal(classified.readyForApplications, true)
  assert.doesNotThrow(() => assertCollectionReady(classified))
  const report = generateCollectionReport(classified)
  assert.match(report.markdown, /Companies: 1\. Sources: 2/)
  assert.match(report.markdown, /Vacancies with Telegram — apply later/)
  assert.equal(report.vacancies.length, 1)
  assert.equal(report.vacancies[0].nextAction, 'apply_later_telegram')
  assert.equal(report.blockers.length, 0)
  assert.equal(report.gaps.length, 2)
  assert.throws(() => validateApplicationSelection({ candidate: { id: 'fixture', stackIds: ['java'] } as any, batchId: 'later', collection: classified, stackId: 'java', positions: classified.collection.positions.map(p => ({ ...p, applicationDestinations: [] })), mode: 'dry-run', limit: 1 }), /vacancy_deferred_to_telegram/)
})
