import assert from 'node:assert/strict'
import test from 'node:test'
import { loadLatestPublicationEvidence, withLatestPublicationEvidence } from '../vacancy_collection/publication-memory.ts'
import { evaluatePublicationDate } from '../vacancy_collection/publication-date-precheck.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'
import type { Position } from '../types.ts'

const source = { name: 'Example', url: 'https://example.test/jobs', database: { sourceId: '1', companyId: '2', applicationRoute: 'standard_workflow' as const } }
const position: Position = { id: 'p', company: 'Example', title: 'Senior Python Engineer', location: '', description: 'Build Python backend services.', url: 'https://boards.greenhouse.io/example/jobs/123', applyUrl: 'https://boards.greenhouse.io/example/jobs/123', retrievedAt: '2026-09-28T00:00:00Z', source }
const now = new Date('2026-10-08T23:59:59Z')
const evidence = (date: string, sourceId = '1') => ({ sourceId, runId: 'latest', url: 'https://job-boards.greenhouse.io/example/jobs/123', observedAt: '2026-10-08T00:00:00Z', dates: [date] })

test('latest source date excludes an old undated shortlist, without altering original body or observation time', async () => {
  const [updated] = withLatestPublicationEvidence([position], [evidence('2021-02-19')])
  assert.equal(evaluatePublicationDate(updated, await loadSelectionRules(), now).status, 'expired')
  assert.equal(updated.retrievedAt, position.retrievedAt)
  assert.equal(updated.description, position.description)
  assert.equal(position.publicationDates, undefined)
  assert.equal(updated.publicationEvidence?.[0].runId, 'latest')
})

test('15 UTC days pass; 16 fail; genuinely missing dates still pass and update/crawl timestamps never become publication dates', async () => {
  const rules = await loadSelectionRules()
  for (const [date, status] of [['2026-09-23', 'eligible'], ['2026-09-22', 'expired']] as const) {
    assert.equal(evaluatePublicationDate(withLatestPublicationEvidence([position], [evidence(date)])[0], rules, now).status, status)
  }
  assert.equal(evaluatePublicationDate(withLatestPublicationEvidence([position], [])[0], rules, now).status, 'missing')
})

test('source identity, observation age and contradictory date evidence cannot be bypassed', async () => {
  assert.deepEqual(withLatestPublicationEvidence([position], [evidence('2021-02-19', 'other')]), [position])
  assert.deepEqual(withLatestPublicationEvidence([position], [{ ...evidence('2021-02-19'), observedAt: '2020-01-01T00:00:00Z' }]), [position])
  const [updated] = withLatestPublicationEvidence([{ ...position, publishedAt: '2026-10-01' }], [evidence('2021-02-19')])
  assert.equal(evaluatePublicationDate(updated, await loadSelectionRules(), now).decision, 'inspect')
})

test('one bounded SQL read follows current source pointers and includes postings rejected before detail extraction', async () => {
  let calls = 0
  const read: any = async (fn: any) => fn({ query: async (sql: string, params: unknown[]) => {
    calls++; assert.match(sql, /collection_state/); assert.deepEqual(params, [['1']])
    return { rows: [{ source_id: '1', run_id: 'latest', collection: { positions: [], audit: [{ source,
      publicationDatePrecheck: { checkedAt: '2026-10-08T00:00:00Z', outcomes: [{ url: position.url, publicationDate: '2021-02-19', evidence: ['2021-02-19'] }] } }] } }] }
  } })
  const result = await loadLatestPublicationEvidence([position], read)
  assert.equal(calls, 1)
  assert.equal(result.length, 1)
  assert.equal(evaluatePublicationDate(withLatestPublicationEvidence([position], result)[0], await loadSelectionRules(), now).status, 'expired')
  await loadLatestPublicationEvidence([], read)
  assert.equal(calls, 1)
})
