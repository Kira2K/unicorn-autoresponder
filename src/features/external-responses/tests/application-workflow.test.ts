import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withTestAnswers } from '../application_preparation/test-answers.ts'
import { withPreparedAnswers } from '../application_preparation/prepared-answers.ts'
import { createAnswerGenerator } from '../application_preparation/answers.ts'
import { nextCampaignStep, recordCampaignCollection, openCampaign } from '../application_workflow/campaign.ts'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFileStore } from '../infrastructure/store.ts'
import { buildCampaignScope } from '../stack_catalog/campaign.ts'
import { collectVacancies } from '../vacancy_collection/index.ts'
import { classifyVacancies } from '../stack_classification/index.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'
import { runApplication } from '../application_workflow/index.ts'
import { tailorCv, cvHash } from '../application_preparation/tailoring.ts'
import { generateReport } from '../reporting/index.ts'
test('Lever required markers and reviewed multi-option answers retain exact choices', async () => {
  const candidate: any = { facts: { fullName: { value: 'Test Person', evidence: 'confirmed' } } }
  const form: any = { fields: [{ key: 'name', label: 'Full name✱', type: 'text', required: true, options: [] }, { key: 'tools', label: 'Tools', type: 'checkbox-group', required: true, options: ['A', 'B', 'None'] }] }
  const generator = withPreparedAnswers(createAnswerGenerator(), { tools: { value: '["A","B"]', evidence: ['reviewed'] } })
  const answer = await generator.generate(candidate, {} as any, form)
  assert.deepEqual(answer.missing, []); assert.equal(answer.values.name.value, 'Test Person'); assert.equal(answer.values.tools.value, '["A","B"]')
  const invalid = withPreparedAnswers(createAnswerGenerator(), { tools: { value: '["A","unknown"]', evidence: ['reviewed'] } })
  assert.equal((await invalid.generate(candidate, {} as any, form)).missing.length, 1)
})
test('aggressive answers cover all scoped targets, never another batch/student/position or candidate facts', async () => {
  const candidate: any = { id: 'kirill', databaseClientId: '35', facts: {} }, form: any = { fields: [{ key: 'lang', label: 'Chinese', required: true, options: ['C1', 'No'] }] }
  const base: any = { generate: async () => ({ values: {}, missing: form.fields }) }
  const rows = ['a', 'b'].map(positionId => ({ campaignId: 'test', studentId: '35', batchId: 'batch', positionId, values: { lang: { value: 'C1', evidence: ['explicit operator test instruction'] } } }))
  const generator = withTestAnswers(base, { campaignId: 'test', studentId: '35', batchId: 'batch', targets: ['a', 'b'], answers: rows })
  for (const id of ['a', 'b']) assert.equal((await generator.generate(candidate, { id } as any, form)).values.lang.value, 'C1')
  await assert.rejects(generator.generate(candidate, { id: 'c' } as any, form), /scope/)
  await assert.rejects(generator.generate({ ...candidate, databaseClientId: '36' }, { id: 'a' } as any, form), /scope/)
  assert.throws(() => withTestAnswers(base, { campaignId: 'test', studentId: '35', batchId: 'other', targets: ['a', 'b'], answers: rows }), /scope/)
  assert.deepEqual(candidate.facts, {})
})
test('campaign waits for initial confirmation and finishes first matching batch or three empty batches', () => {
  const state: any = { initialConfirmed: false, scope: { companyBatches: [['1'], ['2'], ['3']] }, batches: [] }
  assert.equal(nextCampaignStep(state).stage, 'initial_application')
  state.initialConfirmed = true; assert.deepEqual(nextCampaignStep(state), { stage: 'collection', companyIds: ['1'] })
  state.batches.push({ companyIds: ['1'], targets: [], completed: true }); assert.deepEqual(nextCampaignStep(state), { stage: 'collection', companyIds: ['2'] })
  state.batches.push({ companyIds: ['2'], targets: ['role'], completed: false }); assert.equal(nextCampaignStep(state).stage, 'applications')
  state.batches[1].completed = true; assert.equal(nextCampaignStep(state).stage, 'complete')
  state.batches[1].targets = []; state.batches.push({ companyIds: ['3'], targets: [], completed: true }); assert.equal(nextCampaignStep(state).stage, 'complete')
})

test('campaign freezes complete three-stack batches in order; failed targets never authorize replacements', () => {
  const state: any = { scope: { initialTargets: ['initial'], companyBatches: [['1','2','3','4','5'],['6','7','8','9','10']], stackIds: ['2','3','5'] }, initialConfirmed: false, batches: [] }
  const input = { runId: 'scan1', batchId: 'apply1', companyIds: ['1','2','3','4','5'], stackIds: ['2','3','5'], targets: ['a','b'], collectionComplete: true }
  assert.throws(() => recordCampaignCollection(state, input), /out_of_order/)
  state.initialConfirmed = true
  assert.throws(() => recordCampaignCollection(state, { ...input, collectionComplete: false }), /complete_three_stack/)
  assert.throws(() => recordCampaignCollection(state, { ...input, stackIds: ['3'] }), /complete_three_stack/)
  recordCampaignCollection(state, input); recordCampaignCollection(state, input)
  assert.equal(state.batches.length, 1)
  assert.throws(() => recordCampaignCollection(state, { ...input, targets: ['replacement'] }), /immutable/)
  assert.throws(() => recordCampaignCollection(state, { ...input, runId: 'scan2', companyIds: ['6','7','8','9','10'] }), /out_of_order/)
  state.batches[0].completed = true; assert.equal(nextCampaignStep(state).stage, 'complete')
})

test('explicit initial continuation unlocks only the existing follow-up scope without fabricating confirmation', () => {
  const state: any = { scope: { initialBatch: 'initial', initialTargets: ['initial-role'], companyBatches: [['1','2','3','4','5']], stackIds: ['2','3','5'] }, initialConfirmed: false, batches: [] }
  const approval = { initialBatch: 'initial', approvedAt: new Date().toISOString(), approvalReference: 'Operator says leave this position and proceed to others' }
  state.initialContinuation = { ...approval, initialBatch: 'other' }; assert.equal(nextCampaignStep(state).stage, 'initial_application')
  state.initialContinuation = { ...approval, approvalReference: '' }; assert.equal(nextCampaignStep(state).stage, 'initial_application')
  state.initialContinuation = approval
  assert.deepEqual(nextCampaignStep(state), { stage: 'collection', companyIds: ['1','2','3','4','5'] })
  assert.equal(state.initialConfirmed, false)
  recordCampaignCollection(state, { runId: 'next', batchId: 'apply-next', companyIds: ['1','2','3','4','5'], stackIds: ['2','3','5'], targets: ['next-role'], collectionComplete: true })
  assert.equal(nextCampaignStep(state).stage, 'applications'); assert.equal(state.initialConfirmed, false)
})

test('campaign progression resumes from SQL state and persists SQL before local checkpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'campaign-progress-'))
  const scope: any = { id: 'test', approvalReference: 'explicit', approvedAt: new Date().toISOString(), companyBatches: [['1','2','3','4','5']] }
  const sql: any = { scope, initialConfirmed: true, batches: [] }; let saved = false
  try {
    const campaign = await openCampaign(directory, scope, { load: async () => sql, save: async s => { saved = s.initialConfirmed } })
    assert.equal(campaign.state.initialConfirmed, true); await campaign.save(); assert.equal(saved, true)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('public workflow pauses for test review, reuses the generated artifact and uploads only its exact bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'application-workflow-')), store = createFileStore(directory)
  const original = Buffer.from('%PDF-original'), tailored = Buffer.from('%PDF-tailored-specific-role')
  const candidate: any = { id: 'student', databaseClientId: '35', cv: { path: join(directory, 'original.pdf'), fileName: 'original.pdf', sha256: cvHash(original) }, facts: {}, criteria: { titles: [] }, history: [], createdAt: new Date().toISOString() }
  await writeFile(candidate.cv.path, original); await store.saveCandidate(candidate)
  const source: any = { name: 'Example', url: 'https://jobs.example', database: { companyId: '1', sourceId: '1', applicationRoute: 'standard_workflow' } }
  const position: any = { id: 'test', company: 'Example', title: 'Senior Fullstack Engineer', description: 'We are looking for you to build our user-facing product with TypeScript and React. You will work with our team on features and improve the customer experience. The team builds frontend applications and Node.js services. We offer remote work throughout Europe.', location: 'Europe', url: 'https://jobs.example/1', applyUrl: 'https://jobs.example/1/apply', source, retrievedAt: new Date().toISOString() }
  const scope = buildCampaignScope({ database: 'fixture', stacks: [{ id: '3', name: 'FullStack', description: 'Senior JS product development' }], students: [{ studentId: '35', stackId: '3' }] })
  const raw = await collectVacancies({ runId: 'test', sources: [source], scope }, { strategy: { name: 'fixture', discover: async () => ({ positions: [position], audit: [{ source, status: 'complete', pages: [source.url], found: 1, issues: [] }] }) } })
  const rules = await loadSelectionRules(), decision: any = { decision: 'eligible', reasons: ['fixture approved'], evidence: ['TypeScript and React'] }
  const collection = await classifyVacancies({ collection: raw, selectionRules: rules }, { assess: async () => decision, assessGlobal: async () => decision })
  const p = collection.collection.positions[0], policy = { id: 'test-v1', approvedAt: new Date().toISOString(), approvalReference: 'fixture' }
  let calls = 0, uploads = 0, submissions = 0, opens = 0
  const deps: any = { store, rules, event: async () => {}, restrictions: { load: async () => ({ studentId: '35', checkedAt: new Date().toISOString(), complete: true, rules: [] }) }, answers: { generate: async () => ({ values: {}, missing: [] }) }, adapters: [{ name: 'mock', supports: () => true, open: async () => { opens++; return ({ inspect: async () => ({ fields: [], text: '', url: p.applyUrl, closed: false, aiBan: false }), fill: async (c: any) => { uploads++; assert.deepEqual(await readFile(c.cv.path), tailored); assert.notEqual(c.cv.path, candidate.cv.path) }, verify: async () => [], reconcile: async () => ({ status: 'unknown' }), close: async () => {}, submit: async () => { submissions++; return { status: 'succeeded', detail: 'confirmed', evidence: { url: p.applyUrl, observedAt: new Date().toISOString(), confirmation: 'captured', message: 'Application received' } } } }) } }], tailor: () => tailorCv({ candidate, position: p, batchId: 'one', policy, directory: join(directory, 'tailored') }, { service: { tailorFromPdf: async () => { calls++; return { url: 'https://files.example/result' } } }, inspect: async b => ({ pages: 1, text: b.toString(), textHash: cvHash(b) }), download: async () => tailored }) }
  const input: any = { candidate, batchId: 'one', collection, positions: [p], stackId: 'stack-3', limit: 1, mode: 'live', market: 'en', tailoringPolicy: policy, testCampaign: { id: 'test', answerOverride: true } }
  try {
    const paused = await runApplication(input, deps)
    assert.equal(paused.records[0].status, 'blocked'); assert.equal(calls, 1); assert.equal(uploads, 0); assert.equal(submissions, 0)
    input.resume = true; input.testReviews = { [p.id]: { result: 'failed', sha256: cvHash(tailored), evidence: 'Fixture failed content check', reviewedAt: new Date().toISOString() } }
    const beforeResume = opens
    const rejected = await runApplication(input, deps)
    assert.equal(opens, beforeResume + 1, 'compatible resume skips the preliminary dry-run browser pass')
    assert.equal(rejected.records[0].preparedCv?.testReview?.result, 'failed'); assert.match(rejected.records[0].detail, /test_cv_review_failed/)
    assert.equal(calls, 1); assert.equal(uploads, 0); assert.equal(submissions, 0)
    input.resume = true; input.testReviews = { [p.id]: { result: 'passed', sha256: cvHash(tailored), evidence: 'Fixture review of exact result', reviewedAt: new Date().toISOString() } }
    const done = await runApplication(input, deps)
    assert.equal(done.records[0].status, 'succeeded'); assert.equal(calls, 1); assert.equal(uploads, 1); assert.equal(submissions, 1)
    await runApplication(input, deps); assert.equal(submissions, 1); assert.equal(calls, 1)
    assert.deepEqual(await readFile(candidate.cv.path), original)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('explicit original CV mode uploads verified original once without tailoring and freezes attachment history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'original-cv-workflow-')), store = createFileStore(directory)
  const original = Buffer.from('%PDF-original-for-mode'), sha256 = cvHash(original)
  const candidate: any = { id: 'student', databaseClientId: '4', cv: { path: join(directory, 'original.pdf'), fileName: 'original.pdf', sha256 }, facts: {}, criteria: { titles: [] }, history: [], createdAt: new Date().toISOString() }
  await writeFile(candidate.cv.path, original); await store.saveCandidate(candidate)
  const source: any = { name: 'Example', url: 'https://jobs.example', database: { companyId: '1', sourceId: '1', applicationRoute: 'standard_workflow' } }
  const position: any = { id: 'role', company: 'Example', title: 'Backend Engineer', description: 'We are looking for a backend engineer to build reliable Python data services. You will design APIs, maintain production systems, and collaborate with data teams. The work involves Python, SQL, testing, and cloud infrastructure in an English-speaking remote team.', location: 'Remote', url: 'https://jobs.example/1', applyUrl: 'https://jobs.example/1/apply', source, retrievedAt: new Date().toISOString() }
  const scope = buildCampaignScope({ database: 'fixture', stacks: [{ id: '2', name: 'Python', description: 'Python backend development' }], students: [{ studentId: '4', stackId: '2' }] })
  const raw = await collectVacancies({ runId: 'original-test', sources: [source], scope }, { strategy: { name: 'fixture', discover: async () => ({ positions: [position], audit: [{ source, status: 'complete', pages: [source.url], found: 1, issues: [] }] }) } })
  const rules = await loadSelectionRules(), decision: any = { decision: 'eligible', reasons: ['fixture approved'], evidence: ['Python backend'] }
  const collection = await classifyVacancies({ collection: raw, selectionRules: rules }, { assess: async () => decision, assessGlobal: async () => decision })
  let tailoringCalls = 0, uploads = 0, submissions = 0
  const deps: any = { store, rules, event: async () => {}, restrictions: { load: async () => ({ studentId: '4', checkedAt: new Date().toISOString(), complete: true, rules: [] }) }, answers: { generate: async () => ({ values: {}, missing: [] }) },
    adapters: [{ name: 'mock', supports: () => true, open: async () => ({ inspect: async () => ({ fields: [], text: '', url: position.applyUrl, closed: false, aiBan: false }), fill: async (c: any) => { uploads++; assert.equal(c.cv.path, candidate.cv.path); assert.equal(c.cv.sha256, sha256); assert.deepEqual(await readFile(c.cv.path), original) }, verify: async () => [], reconcile: async () => ({ status: 'unknown' }), close: async () => {}, submit: async () => { submissions++; return { status: 'succeeded', detail: 'confirmed', evidence: { url: position.applyUrl, observedAt: new Date().toISOString(), confirmation: 'captured', message: 'Application received' } } } }) }],
    tailor: async () => { tailoringCalls++; throw Error('tailor_must_not_run') } }
  const approval = { approvedAt: new Date().toISOString(), approvalReference: 'Explicit test approval to send original CV' }
  const input: any = { candidate, batchId: 'original', collection, positions: collection.collection.positions, stackId: 'stack-2', limit: 1, mode: 'live', market: 'en', tailoringPolicy: { id: 'unused', approvedAt: approval.approvedAt, approvalReference: 'fixture' }, cvMode: 'original', originalCvApproval: approval }
  try {
    const done = await runApplication(input, deps)
    assert.equal(done.records[0].status, 'succeeded'); assert.equal(done.cvSelection?.mode, 'original'); assert.equal(done.cvSelection?.sha256, sha256)
    assert.equal(tailoringCalls, 0); assert.equal(uploads, 1); assert.equal(submissions, 1)
    const report = await generateReport({ candidateId: candidate.id, batchId: input.batchId }, { store })
    assert.match(report.markdown, /Original CV selected for batch original/)
    assert.match(report.markdown, /Original PDF/)
    assert.match(report.csv, /"original",".*original\.pdf"/)
    await runApplication({ ...input, resume: true }, deps); assert.equal(submissions, 1)
    await assert.rejects(runApplication({ ...input, cvMode: undefined, resume: true }, deps), /original_cv_selection_immutable/)
    await assert.rejects(runApplication({ ...input, originalCvApproval: undefined, resume: true }, deps), /original_cv_approval_required/)
    const attemptedTailored: any = await store.batch(candidate.id, input.batchId)
    delete attemptedTailored.cvSelection
    await store.saveBatch(attemptedTailored)
    await assert.rejects(runApplication({ ...input, resume: true }, deps), /attempted_attachment_mode_immutable/)
    await writeFile(candidate.cv.path, Buffer.from('%PDF-changed'))
    await assert.rejects(runApplication({ ...input, resume: true }, deps), /original_cv_hash_mismatch/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
