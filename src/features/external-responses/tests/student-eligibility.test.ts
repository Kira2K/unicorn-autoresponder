import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCampaignScope, assertCampaignScope } from '../stack_catalog/campaign.ts'
import { collectVacancies } from '../vacancy_collection/index.ts'
import { classifyVacancies } from '../stack_classification/index.ts'
import { matchCandidatePositions } from '../candidate_matching/index.ts'
import { applyToPositions } from '../applications/index.ts'
import { createFileStore } from '../infrastructure/store.ts'
import type { Candidate, Position, ApplicationAdapter } from '../types.ts'
import type { RestrictionPolicy } from '../candidate_matching/restrictions.ts'
import { createRestrictionEvaluator } from '../candidate_matching/restriction-ai.ts'
import type { Client } from '../infrastructure/ai.ts'

const source = { name: 'Example', url: 'https://example.test/jobs' }
const position: Position = { id: '', company: 'Example', title: 'Senior Java Backend', description: 'Java Spring backend work. The role is in Lyon; the company also has a Paris office.', location: 'Lyon', url: source.url + '/1', applyUrl: source.url + '/1', source, retrievedAt: '' }
const scopeInput = { database: 'unicorn_noco_copy', stacks: [{ id: '5', name: 'Java', description: 'Middle/senior backend Java Spring.' }, { id: '22', name: 'Vue', description: null }], students: [{ studentId: '20', stackId: '5' }] }
const candidate: Candidate = { id: 'local', databaseClientId: '20', stackIds: [], cv: { path: '', sha256: '', fileName: '' }, facts: {}, criteria: { titles: ['totally different legacy preference'], seniorOnly: true }, history: [], createdAt: '' }
const emptyRules: RestrictionPolicy = { load: async () => ({ studentId: '20', complete: true, checkedAt: new Date().toISOString(), rules: [] }) }
async function collection() {
  const result = await collectVacancies({ runId: 'fixture', sources: [source], scope: buildCampaignScope(scopeInput) }, { strategy: { name: 'mock', discover: async () => ({ positions: [position], audit: [{ source, status: 'complete', pages: [source.url], found: 1, issues: [] }] }) } })
  return classifyVacancies({ collection: result }, { assess: async () => ({ decision: 'eligible', reasons: ['Stack matches'], evidence: ['Java Spring backend work.'] }) })
}

test('campaign scope uses existing populated stacks only; unknown IDs and missing descriptions do not silently pass', () => {
  const scope = buildCampaignScope(scopeInput)
  assert.deepEqual(scope.stacks.map(s => s.id), ['stack-5'])
  assert.deepEqual(scope.stacks[0].studentIds, ['20'])
  assert.equal(scope.excluded[0].databaseId, '22'); assertCampaignScope(scope)
  assert.throws(() => buildCampaignScope({ ...scopeInput, stackIds: ['invented'] }), /unknown_database_stack/)
  assert.throws(() => buildCampaignScope({ ...scopeInput, studentIds: ['missing'] }), /unknown_database_student/)
  const missing = buildCampaignScope({ ...scopeInput, students: [{ studentId: '20', stackId: '22' }] })
  assert.throws(() => assertCampaignScope(missing), /stack_description required/)
})

test('empty student scope never starts crawling; scoped classification cannot replace database descriptions', async () => {
  let calls = 0
  const scope = buildCampaignScope({ ...scopeInput, students: [] })
  const result = await collectVacancies({ runId: 'empty', sources: [source], scope }, { strategy: { name: 'mock', discover: async () => { calls++; return { positions: [], audit: [] } } } })
  assert.equal(calls, 0); assert.equal(result.positions.length, 0)
  const collected = (await collection()).collection
  await assert.rejects(classifyVacancies({ collection: collected, stacks: [{ id: 'arbitrary', name: 'Arbitrary', description: 'Any job' }] }), /override_forbidden/)
  const noAssessor = await classifyVacancies({ collection: collected })
  assert.equal(noAssessor.groups['stack-5'].reviewIds.length, 1)
})

test('stack match and clear restrictions allow automatically, regardless of legacy CV-fit preferences', async () => {
  const result = await matchCandidatePositions({ candidate, collection: await collection(), stackId: 'stack-5' }, { restrictions: emptyRules })
  assert.equal(result.positions[0].fit?.decision, 'eligible')
  assert.match(result.positions[0].fit!.reasons[0], /no applicable restriction/)
})

test('matching needs no CV and passes only confirmed student facts to policy adapters', async () => {
  const collected = await collection()
  const confirmed = { value: 'English', source: 'confirmed' as const, evidence: 'Student answer' }
  let loads = 0, evaluations = 0
  const assertContext = (student: Parameters<RestrictionPolicy['load']>[0]) => {
    assert.equal(Object.hasOwn(student, 'cv'), false)
    assert.equal(Object.hasOwn(student, 'criteria'), false)
    assert.deepEqual(student.facts, { language: confirmed })
    assert.equal(student.databaseClientId, '20')
  }
  const restrictions: RestrictionPolicy = {
    load: async student => { loads++; assertContext(student); return { ...await emptyRules.load(student), rules: [{ id: 'language', instruction: 'English is allowed', source: 'student constraint' }] } },
    evaluate: async (_rule, student) => { evaluations++; assertContext(student); return { decision: 'clear', reason: 'Confirmed language allowed', evidence: ['Student answer'] } }
  }
  for (const experience of ['Unrelated work', 'Twenty years of Java']) {
    const student = { id: candidate.id, databaseClientId: '20', stackIds: [], history: [], facts: { language: confirmed, experience: { value: experience, source: 'cv' as const, evidence: 'Old CV' } } }
    // Throwing getters prove that selection neither reads the PDF reference nor legacy CV-fit criteria.
    Object.defineProperty(student, 'cv', { get() { throw Error('CV must not be read for eligibility') } })
    Object.defineProperty(student, 'criteria', { get() { throw Error('Legacy preferences must not be read') } })
    const result = await matchCandidatePositions({ candidate: student, collection: collected, stackId: 'stack-5' }, { restrictions })
    assert.equal(result.positions[0].fit?.decision, 'eligible')
    assert.equal(student.facts.experience.value, experience)
  }
  assert.equal(loads, 2); assert.equal(evaluations, 2)
})

test('restriction AI never receives CV-derived facts, including direct adapter calls', async () => {
  const facts = { language: { value: 'English', source: 'cv' as const, evidence: 'CV' }, city: { value: 'Barcelona', source: 'confirmed' as const, evidence: 'Student answer' } }
  const payloads: Record<string, any>[] = []
  const client = { respond: async (messages: { content: string }[]) => {
    const payload = JSON.parse(messages[0].content); payloads.push(payload)
    return { decision: payload.candidateFacts.language ? 'clear' : 'review', reason: 'Needs confirmed language', evidence: [] }
  } } as unknown as Client
  const evaluate = createRestrictionEvaluator(client)
  const result = await evaluate({ id: 'language', instruction: 'No English-language roles', source: 'student rule' }, { ...candidate, facts }, position)
  assert.equal(result.decision, 'review')
  assert.deepEqual(payloads[0].candidateFacts, { city: facts.city })
  assert.equal(JSON.stringify(payloads[0]).includes('"source":"cv"'), false)
  assert.equal(facts.language.source, 'cv')
})

test('application gates exclude CV data while preparation keeps the original candidate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'external-no-cv-eligibility-')), store = createFileStore(root, join(root, 'logs'))
  const original: Candidate = { ...candidate, facts: { experience: { value: 'Old CV text', source: 'cv', evidence: 'PDF' }, city: { value: 'Barcelona', source: 'confirmed', evidence: 'Student answer' } } }
  let loads = 0, evaluations = 0, preparations = 0
  const assertContext = (student: Parameters<RestrictionPolicy['load']>[0]) => {
    assert.equal(Object.hasOwn(student, 'cv'), false)
    assert.deepEqual(Object.keys(student.facts), ['city'])
  }
  const restrictions: RestrictionPolicy = {
    load: async student => { loads++; assertContext(student); return { ...await emptyRules.load(student), rules: [{ id: 'city', instruction: 'Barcelona is allowed', source: 'student rule' }] } },
    evaluate: async (_rule, student) => { evaluations++; assertContext(student); return { decision: 'clear', reason: 'Residence allowed', evidence: ['Student answer'] } }
  }
  const adapter: ApplicationAdapter = { name: 'mock', supports: () => true, open: async () => ({ inspect: async () => ({ fields: [{ key: 'experience', label: 'Describe experience', type: 'textarea', required: true, options: [] }], text: '', url: position.url, closed: false, aiBan: false }), fill: async () => { throw Error('Dry run must not fill') }, verify: async () => [], submit: async () => { throw Error('Dry run must not submit') }, reconcile: async () => ({ status: 'unknown', detail: 'No submission' }), close: async () => {} }) }
  try {
    await store.saveCandidate(original)
    const collected = await collection()
    const result = await applyToPositions({ candidate: original, collection: collected, stackId: 'stack-5', batchId: 'no-cv-decision', positions: collected.collection.positions, limit: 1, mode: 'dry-run' }, {
      store, adapters: [adapter], restrictions, answers: { generate: async student => { preparations++; assert.deepEqual(student.cv, original.cv); assert.deepEqual(student.facts, original.facts); return { values: { experience: { value: String(student.facts.experience.value), evidence: ['PDF'] } }, missing: [] } } }
    })
    assert.equal(result.records[0].status, 'prepared'); assert(loads > 0); assert.equal(evaluations, loads); assert.equal(preparations, 1)
    assert.deepEqual((await store.candidate(original.id)).facts, original.facts)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('contextual restrictions handle allowed cities; failures and ambiguous evidence require review', async () => {
  const collected = await collection()
  const restrictions: RestrictionPolicy = { load: async () => ({ ...await emptyRules.load(candidate), rules: [{ id: 'city', instruction: 'Apply only to positions in Paris', source: 'student constraint' }] }), evaluate: async (rule, c, p) => {
    assert.equal(rule.instruction, 'Apply only to positions in Paris'); assert.equal(p.location, 'Lyon')
    return { decision: 'block', reason: 'The role is based in Lyon, despite mentioning a Paris office.', evidence: [p.location, rule.instruction] }
  } }
  const run = (policy: RestrictionPolicy) => matchCandidatePositions({ candidate, collection: collected, stackId: 'stack-5' }, { restrictions: policy })
  assert.equal((await run(restrictions)).positions[0].fit?.decision, 'excluded')
  assert.equal((await run({ ...restrictions, evaluate: undefined })).positions[0].fit?.decision, 'review')
  assert.equal((await run({ load: async () => { throw Error('DB down') } })).positions[0].fit?.decision, 'review')
  assert.equal((await run({ ...restrictions, evaluate: async () => ({ decision: 'clear', reason: 'No evidence', evidence: [] }) })).positions[0].fit?.decision, 'review')
  await assert.rejects(matchCandidatePositions({ candidate: { ...candidate, databaseClientId: '99' }, collection: collected, stackId: 'stack-5' }, { restrictions }), /candidate_stack_mismatch/)
})

test('live application rechecks restrictions after preparation; selection override cannot bypass new restrictions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'external-eligibility-')), store = createFileStore(root, join(root, 'logs'))
  let loads = 0, submits = 0, fills = 0
  const adapter: ApplicationAdapter = { name: 'mock', supports: () => true, open: async () => ({ inspect: async () => ({ fields: [], text: '', url: position.url, closed: false, aiBan: false }), fill: async () => { fills++ }, verify: async () => [], submit: async () => { submits++; return { status: 'unknown', detail: 'Should not submit' } }, reconcile: async () => ({ status: 'unknown', detail: 'No receipt' }), close: async () => {} }) }
  const restrictions: RestrictionPolicy = { load: async () => ({ ...await emptyRules.load(candidate), rules: ++loads < 3 ? [] : [{ id: 'new', instruction: 'Do not apply to this employer', source: 'fresh DB' }] }), evaluate: async () => ({ decision: 'block', reason: 'A restriction was added during preparation', evidence: ['Fresh DB rule'] }) }
  try {
    await store.saveCandidate(candidate)
    const collected = await collection()
    const result = await applyToPositions({ candidate, collection: collected, stackId: 'stack-5', batchId: 'one', positions: collected.collection.positions, limit: 1, mode: 'live', reviewOverride: 'Old manual override' }, { store, adapters: [adapter], answers: { generate: async () => ({ values: {}, missing: [] }) }, restrictions })
    assert.equal(fills, 1); assert.equal(submits, 0); assert.equal(result.records[0].reason, 'restriction_applies')
    assert.equal(result.records[0].position.restrictionChecks?.[0].ruleId, 'new')
  } finally { await rm(root, { recursive: true, force: true }) }
})
