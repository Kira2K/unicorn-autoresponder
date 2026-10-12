import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCampaignScope } from '../stack_catalog/campaign.ts'
import { classifyVacancies } from '../stack_classification/index.ts'
import { refreshSavedClassification } from '../stack_classification/refresh-saved.ts'
import type { SelectionRules } from '../stack_classification/rules.ts'
import type { StackDecision } from '../stack_classification/index.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'

const rules = (text: string): SelectionRules => ({ version: 1, source: 'fixture', text, sha256: createHash('sha256').update(text).digest('hex') })
const source = { name: 'Example', url: 'https://example.test/careers', database: { sourceId: '1', companyId: '2', applicationRoute: 'standard_workflow' as const } }
const position = { id: 'p1', source, company: 'Example', title: 'Senior Python Engineer', location: 'Worldwide',
  description: 'Build Python services and deliver reliable production systems with the engineering team.',
  url: 'https://example.test/jobs/1', applyUrl: 'https://example.test/jobs/1', retrievedAt: '2026-10-01T00:00:00.000Z' }
const scope = () => buildCampaignScope({ database: 'unicorn_noco_copy', capturedAt: '2026-10-01T00:00:00.000Z',
  stacks: [{ id: '2', name: 'Python', description: 'Python backend roles' }], students: [{ studentId: '7', stackId: '2' }] })
const decision: StackDecision = { decision: 'eligible', reasons: ['Confirmed against public description'], evidence: [position.title] }
const provenance = { origin: 'assistant_session' as const, reviewedBy: 'reviewer', reviewedAt: '2026-10-01T01:00:00.000Z', reviewHash: 'review-1' }
async function saved(text = '## Rules\nCyprus and global roles require semantic review.', legacy = false) {
  const campaign = scope()
  return classifyVacancies({ collection: { version: 1, runId: 'old-run', sources: [source], positions: [position],
      audit: [{ source, status: 'complete', pages: [source.url], found: 1, issues: [] }],
      createdAt: '2026-10-01T00:00:00.000Z', scope: campaign },
    selectionRules: rules(text), ...(!legacy ? { assessmentCacheVersion: 'semantic-v1' as const, assessmentProvenance: provenance } : {}) },
    { assessGlobal: async () => decision, assess: async () => decision })
}

test('refresh reuses proven semantic review and preserves public observations in a new run', async () => {
  const before = await saved()
  const result = await refreshSavedClassification({ saved: before, rules: before.selectionRules!, stacks: before.stacks, runId: 'new-run' })
  assert.equal(result.summary.newAiCalls, 0)
  assert.equal(result.summary.reused, 1)
  assert.equal(result.summary.pending, 0)
  assert.equal(result.classified.collection.runId, 'new-run')
  assert.equal(result.classified.collection.createdAt, before.collection.createdAt)
  assert.deepEqual(result.classified.collection.positions, before.collection.positions)
  assert.deepEqual(result.classified.collection.audit, before.collection.audit)
  assert.equal(result.classified.evaluation?.records.p1.fromRun, 'old-run')
  assert.deepEqual(result.updates.p1.semanticAssessment, before.semanticAssessments?.p1)
})

test('machine-check edit retains compatible semantic review while prose edit requires a new review', async () => {
  const original = '## Rules\nCyprus needs specific residence evidence.\n\n```salary-precheck-json\n{"version":1,"minimumGrossMonthlyUsd":1000}\n```'
  const before = await saved(original)
  const machine = rules(original.replace('"minimumGrossMonthlyUsd":1000', '"minimumGrossMonthlyUsd":2000'))
  const changed = await refreshSavedClassification({ saved: before, rules: machine, stacks: before.stacks, runId: 'machine-run' })
  assert.equal(changed.summary.changedChecks, true)
  assert.equal(changed.summary.reused, 1)
  const prose = rules(original.replace('Cyprus needs specific residence evidence.', 'Cyprus needs current residence documents.'))
  const pending = await refreshSavedClassification({ saved: before, rules: prose, stacks: before.stacks, runId: 'prose-run' })
  assert.equal(pending.summary.reused, 0)
  assert.deepEqual(pending.classified.evaluation?.pendingIds, ['p1'])
})

test('legacy or changed stack descriptions cannot be silently rekeyed', async () => {
  const legacy = await saved(undefined, true)
  const result = await refreshSavedClassification({ saved: legacy, rules: legacy.selectionRules!, stacks: legacy.stacks, runId: 'legacy-run' })
  assert.equal(result.summary.pending, 1)
  const before = await saved()
  const changed = await refreshSavedClassification({ saved: before, rules: before.selectionRules!,
    stacks: before.stacks.map(stack => ({ ...stack, description: 'Different Python scope' })), runId: 'stack-run' })
  assert.equal(changed.summary.reused, 0)
  assert.equal(changed.summary.pending, 1)
})

test('bounded reviewed assessments resolve changed prose without paid calls', async () => {
  const before = await saved()
  let reviews = 0
  const result = await refreshSavedClassification({ saved: before, rules: rules('## Rules\nNew global and Cyprus wording.'),
    stacks: before.stacks, runId: 'review-run', reviewed: { provenance, assess: async () => { reviews++; return { global: decision, stacks: { 'stack-2': decision } } } } })
  assert.equal(reviews, 1)
  assert.equal(result.summary.newAiCalls, 0)
  assert.equal(result.summary.pending, 0)
  assert.equal(result.classified.globalDecisions?.p1.decision, 'eligible')
  assert.equal(result.updates.p1.origin, 'assistant_session')
})

test('newer publication evidence excludes an old undated snapshot before review or cache reuse', async () => {
  const before = await saved()
  let calls = 0
  const result = await refreshSavedClassification({ saved: before, rules: await loadSelectionRules(), stacks: before.stacks, runId: 'date-first', now: new Date('2026-10-08T00:00:00Z'),
    publicationEvidence: [{ sourceId: '1', runId: 'latest-listing', url: position.url, observedAt: '2026-10-08T00:00:00Z', dates: ['2021-02-19'] }],
    reviewed: { provenance, assess: async () => { calls++; throw Error('must_not_review_expired') } } })
  assert.equal(calls, 0)
  assert.equal(result.summary.pending, 0)
  assert.equal(result.classified.globalDecisions?.p1.decision, 'excluded')
  assert.equal(before.collection.positions[0].publicationDates, undefined)
})
