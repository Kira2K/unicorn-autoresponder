import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { intakeCandidate } from '../candidate_intake/index.ts'
import { createFileStore, redact } from '../infrastructure/store.ts'
import { readAts } from '../vacancy_collection/ats-reader.ts'
import { applyToPositions } from '../applications/execute.ts'
import { positionId, isDuplicate } from '../infrastructure/identity.ts'
import { classifyOutcome } from '../applications/outcome.ts'
import { generateReport } from '../reporting/index.ts'
import { discoverPositions, createWebsiteStrategy } from '../vacancy_collection/discover.ts'
import { readSources } from '../vacancy_collection/sources.ts'
import { withPreparedAnswers } from '../application_preparation/prepared-answers.ts'
import type { Candidate, Position, ApplicationAdapter, Outcome, Store } from '../types.ts'

const candidate: Candidate = { id: 'test', cv: { path: '', sha256: '', fileName: 'cv.pdf' }, facts: {}, criteria: { titles: ['fullstack'], seniorOnly: true }, history: [], createdAt: '2026-01-01' }
const position = (n = 1): Position => ({ id: `job-${n}`, company: `Company ${n}`, title: 'Senior Fullstack Engineer', location: 'Spain', description: 'Build React and Node.js products.', url: `https://jobs.ashbyhq.com/company/${n}`, applyUrl: `https://jobs.ashbyhq.com/company/${n}/application`, retrievedAt: '2026-01-01', source: { name: 'test', url: 'https://example.org' }, fit: { decision: 'eligible', reasons: [], evidence: [] } })
async function fixture(fn: (store: Store, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'external-responses-'))
  try { const store = createFileStore(root, join(root, 'logs')); await store.saveCandidate(candidate); await fn(store, root) }
  finally { await rm(root, { recursive: true, force: true }) }
}
function adapter(counter: { fills: number; submits: number }, result?: Outcome): ApplicationAdapter {
  return { name: 'mock', supports: () => true, open: async p => ({
    inspect: async () => ({ fields: [], text: '', url: p.url, closed: false, aiBan: false }),
    fill: async () => { counter.fills++ }, verify: async () => [],
    submit: async () => { counter.submits++; return result ?? { status: 'succeeded', detail: 'Confirmed', evidence: { url: p.url, observedAt: new Date().toISOString(), confirmation: 'captured', message: 'Application received' } } },
    reconcile: async () => ({ status: 'unknown', reason: 'unknown_outcome', detail: 'No receipt' }), close: async () => {}
  }) }
}
const answers = { generate: async () => ({ values: {}, missing: [] }) }

test('an uncertain sent attempt reconciles to email verification without another submit', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, p = position()
  await store.saveBatch({ id: 'email-gate', candidateId: candidate.id, targetIds: [p.id], limit: 1, createdAt: '2026-10-08', updatedAt: '2026-10-08', records: [{ position: p, status: 'unknown', reason: 'unknown_outcome', detail: 'Late request', attempt: 1, updatedAt: '2026-10-08' }] })
  const base = adapter(count)
  const gate: ApplicationAdapter = { ...base, open: async target => ({ ...await base.open(target), reconcile: async () => ({ status: 'blocked', reason: 'email_verification_required', detail: 'An eight-character email code is required.', evidence: { url: target.url, observedAt: new Date().toISOString(), message: 'Code gate visible' } }) }) }
  const result = await applyToPositions({ candidate, batchId: 'email-gate', positions: [p], mode: 'live', limit: 1, resume: true }, { store, adapters: [gate], answers })
  assert.equal(result.records[0].status, 'blocked'); assert.equal(result.records[0].reason, 'email_verification_required'); assert.equal(result.records[0].attempt, 1)
  assert.deepEqual(count, { fills: 0, submits: 0 })
}))

test('distinct ATS IDs with identical titles can resume an unattempted duplicate skip', async () => fixture(async store => {
  const prior = { ...position(), company: 'Xsolla', title: 'Senior Software Engineer (Go)', url: 'https://jobs.lever.co/xsolla/f39ad965-50d7-447c-9820-463a5818c9b8' }
  const next = { ...prior, id: 'new-posting', url: 'https://jobs.lever.co/xsolla/a70bdc3f-3d56-4634-9b8e-a5d40fc4433c', applyUrl: 'https://jobs.lever.co/xsolla/a70bdc3f-3d56-4634-9b8e-a5d40fc4433c/apply' }
  const history = [{ ...prior, status: 'succeeded' as const }]
  assert.equal(isDuplicate(next, history), false)
  assert.equal(isDuplicate({ ...prior, url: prior.url + '/apply' }, history), true)
  assert.equal(isDuplicate(next, [{ ...next, status: 'unknown' as const }]), true)
  assert.equal(isDuplicate(next, [{ ...prior, url: 'https://xsolla.com/careers', status: 'succeeded' as const }]), true)
  assert.equal(isDuplicate(next, [{ ...prior, url: 'https://jobs.ashbyhq.com/xsolla/f39ad965-50d7-447c-9820-463a5818c9b8', status: 'succeeded' as const }]), true)
  await store.saveCandidate({ ...candidate, history })
  await store.saveBatch({ id: 'same-title', candidateId: candidate.id, targetIds: [next.id], limit: 1, createdAt: '2026-10-07', updatedAt: '2026-10-07', records: [{ position: next, status: 'skipped', reason: 'already_applied', detail: 'Old title-only match', attempt: 0, updatedAt: '2026-10-07' }] })
  const count = { fills: 0, submits: 0 }
  const result = await applyToPositions({ candidate, batchId: 'same-title', positions: [next], mode: 'dry-run', limit: 1, resume: true }, { store, adapters: [adapter(count)], answers })
  assert.equal(result.records[0].status, 'prepared'); assert.equal(result.records[0].attempt, 0)
  assert.deepEqual(count, { fills: 0, submits: 0 })
}))

test('verified CAPTCHA continuation keeps one durable attempt and verifies fields before its single continuation click', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, base = adapter(count, { status: 'blocked', reason: 'captcha_required', detail: 'Visible challenge' })
  let ready = false, continuations = 0
  const capable: ApplicationAdapter = { ...base, open: async p => {
    const session = await base.open(p)
    return { ...session, continueAfterCaptcha: async beforeSubmit => {
      if (!ready) return { status: 'blocked', reason: 'captcha_required', detail: 'Still visible' }
      if (!await beforeSubmit()) throw Error('guard_failed')
      assert.equal((await store.batch(candidate.id, 'continuation'))!.records[0].status, 'submitting')
      continuations++
      return { status: 'succeeded', detail: 'Receipt', evidence: { url: p.url, observedAt: new Date().toISOString(), message: 'Application received', confirmation: 'captured' } }
    } }
  } }
  const input = { candidate, batchId: 'continuation', positions: [position()], mode: 'live' as const, limit: 1 }
  const deps = { store, adapters: [capable], answers }
  await applyToPositions(input, deps)
  await applyToPositions({ ...input, mode: 'dry-run', resume: true }, deps)
  assert.equal(continuations, 0)
  ready = true
  const done = await applyToPositions({ ...input, resume: true, humanAssistance: { 'job-1': { observedAt: new Date().toISOString(), reference: 'Operator completed the challenge in the preserved tab' } } }, deps)
  assert.equal(done.records[0].status, 'succeeded'); assert.equal(done.records[0].attempt, 1)
  assert.equal(done.records[0].manualAssistance, true)
  assert.match(done.records[0].humanAssistance!.reference, /Operator completed/)
  assert.equal(count.submits, 1); assert.equal(count.fills, 1); assert.equal(continuations, 1)
  await applyToPositions({ ...input, resume: true }, deps); assert.equal(continuations, 1)
}))

test('continuation never clicks when saved fields fail verification; missing receipt remains uncertain', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, base = adapter(count, { status: 'blocked', reason: 'captcha_required', detail: 'Visible challenge' })
  let invalidate = false, clicks = 0
  const guarded: ApplicationAdapter = { ...base, open: async p => {
    const s = await base.open(p)
    return { ...s, verify: async () => invalidate ? ['Attachment changed'] : [], continueAfterCaptcha: async before => { if (await before()) clicks++; return { status: 'unknown', detail: 'No receipt', reason: 'unknown_outcome' } } }
  } }
  const input = { candidate, batchId: 'invalid-continuation', positions: [position()], mode: 'live' as const, limit: 1 }
  await applyToPositions(input, { store, adapters: [guarded], answers }); invalidate = true
  const result = await applyToPositions({ ...input, resume: true }, { store, adapters: [guarded], answers })
  assert.equal(result.records[0].status, 'unknown'); assert.equal(clicks, 0); assert.equal(count.submits, 1)
}))

test('engine-memory failure is diagnostic and cannot cause duplicate submissions', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }
  const input = { candidate, batchId: 'memory-failure', positions: [position()], mode: 'live' as const, limit: 1 }
  const deps = { store, adapters: [adapter(count)], answers, formMemory: { inspect: async (): Promise<'new'> => { throw Error('offline') }, verified: async () => { throw Error('offline') } } }
  assert.equal((await applyToPositions(input, deps)).records[0].status, 'succeeded')
  await applyToPositions({ ...input, resume: true }, deps); assert.equal(count.submits, 1)
}))

test('explicit operator retry authorizes exactly one additional attempt and retains the earlier unknown outcome', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, deps = { store, adapters: [adapter(count, { status: 'unknown' as const, reason: 'unknown_outcome' as const, detail: 'No verification response' })], answers }
  const input = { candidate, batchId: 'explicit-retry', positions: [position()], mode: 'live' as const, limit: 1 }
  await applyToPositions(input, deps)
  const retryAuthorizations = { 'job-1': { candidateId: candidate.id, batchId: input.batchId, positionId: 'job-1', afterAttempt: 1, approvedAt: new Date().toISOString(), approvalReference: 'User reports image-loading fix and explicitly requests one more attempt' } }
  const second = await applyToPositions({ ...input, resume: true, retryAuthorizations }, deps)
  assert.equal(count.submits, 2); assert.equal(second.records[0].attempt, 2)
  assert.equal(second.records[0].outcomes?.[0].status, 'unknown')
  await applyToPositions({ ...input, resume: true, retryAuthorizations }, deps); assert.equal(count.submits, 2)
  await assert.rejects(applyToPositions({ ...input, resume: true, retryAuthorizations: { 'job-1': { ...retryAuthorizations['job-1'], candidateId: 'different' } } }, deps), /retry_authorization_scope/)
}))

test('explicit employer-policy exception is target-scoped, saved on resume, and requires declining own-words attestation', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, base = adapter(count)
  const field = { key: 'id:own_words', label: 'I agree to use only my own words. AI content disqualifies my application.', type: 'select', required: true, options: ['Yes', 'No'] }
  const guarded: ApplicationAdapter = { ...base, open: async p => { const session = await base.open(p); return { ...session, inspect: async () => ({ ...await session.inspect(), aiBan: true, fields: [field] }) } } }
  const input = { candidate, batchId: 'disclosed-ai', positions: [position(), position(2)], mode: 'dry-run' as const, limit: 2 }
  const drafted = { generate: async () => ({ values: { [field.key]: { value: 'No', evidence: ['AI assistance is disclosed'] } }, missing: [] }) }
  const deps = { store, adapters: [guarded], answers: drafted }
  assert.equal((await applyToPositions(input, deps)).records[0].reason, 'employer_ai_ban')
  const employerAiExceptions = { 'job-1': { reason: 'Candidate explicitly requested retry despite policy', ownWordsFieldKey: field.key } }
  const prepared = await applyToPositions({ ...input, resume: true, employerAiExceptions }, deps)
  assert.equal(prepared.records[0].status, 'prepared'); assert.equal(prepared.records[1].reason, 'employer_ai_ban')
  const wrong = { generate: async () => ({ values: { [field.key]: { value: 'Yes', evidence: ['Wrong attestation'] } }, missing: [] }) }
  const rejected = await applyToPositions({ ...input, mode: 'live', resume: true }, { ...deps, answers: wrong })
  assert.equal(rejected.records[0].reason, 'employer_ai_ban'); assert.deepEqual(count, { fills: 0, submits: 0 })
  const result = await applyToPositions({ ...input, mode: 'live', resume: true }, deps)
  assert.equal(result.records[0].status, 'succeeded'); assert.equal(result.records[1].status, 'blocked')
  assert.deepEqual(count, { fills: 1, submits: 1 }); assert.deepEqual(result.records[0].employerAiException, employerAiExceptions['job-1'])
  assert.match((await generateReport({ candidateId: candidate.id, batchId: input.batchId }, { store })).markdown, /Candidate explicitly requested retry despite policy/)
  await applyToPositions({ ...input, mode: 'live', resume: true }, deps); assert.equal(count.submits, 1)
}))

test('employer policy exception cannot approve changed declarations before submission', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, base = adapter(count); let inspections = 0
  const field = { key: 'id:own_words', label: 'Only my own words; AI content disqualifies.', type: 'select', required: true, options: ['Yes', 'No'] }
  const guarded: ApplicationAdapter = { ...base, open: async p => { const session = await base.open(p); return { ...session, inspect: async () => ({ ...await session.inspect(), aiBan: true, fields: [++inspections === 1 ? field : { ...field, key: 'id:changed_declaration' }] }) } } }
  const result = await applyToPositions({ candidate, batchId: 'policy-changed', positions: [position()], limit: 1, mode: 'live', employerAiExceptions: { 'job-1': { reason: 'Explicit user retry', ownWordsFieldKey: field.key } } }, { store, adapters: [guarded], answers: { generate: async () => ({ values: { [field.key]: { value: 'No', evidence: ['Disclosed AI assistance'] } }, missing: [] }) } })
  assert.equal(result.records[0].reason, 'employer_ai_ban'); assert.equal(count.submits, 0)
}))

test('explicit selection override preserves fit evidence and never bypasses duplicate prevention', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, p = { ...position(), fit: { decision: 'excluded' as const, reasons: ['Backend balance'], evidence: ['Backend services'] } }
  const input = { candidate, batchId: 'override', positions: [p], mode: 'live' as const, limit: 1 }
  const deps = { store, adapters: [adapter(count)], answers }
  assert.equal((await applyToPositions(input, deps)).records[0].status, 'blocked')
  const result = await applyToPositions({ ...input, resume: true, reviewOverride: 'Candidate explicitly selected this role for a browser test' }, deps)
  assert.equal(result.records[0].status, 'succeeded'); assert.equal(result.records[0].position.fit?.decision, 'excluded')
  assert.match(result.records[0].reviewOverride!, /browser test/)
  await applyToPositions({ ...input, batchId: 'duplicate', reviewOverride: 'Candidate selection' }, deps)
  assert.equal(count.submits, 1)
}))

test('prepared answers retain provenance without changing candidate facts or inventing option labels', async () => {
  const field = { key: 'id:decision', label: 'Relocate?*', type: 'select', required: true, options: ['Yes', 'No'] }
  const form = { fields: [field], text: '', url: position().url, closed: false, aiBan: false }
  const base = { generate: async () => ({ values: {}, missing: [field] }) }, before = structuredClone(candidate)
  const prepared = withPreparedAnswers(base, { 'Relocate?*': { value: 'Yes', evidence: ['Candidate delegated location preferences'] } })
  const result = await prepared.generate(candidate, position(), form)
  assert.deepEqual(result.missing, []); assert.match(result.values[field.key].evidence[0], /delegated/)
  assert.deepEqual(candidate, before)
  const invalid = withPreparedAnswers(base, { 'Relocate?*': { value: 'Maybe', evidence: ['Draft'] } })
  assert.equal((await invalid.generate(candidate, position(), form)).missing.length, 1)
  const unsupported = withPreparedAnswers(base, { 'Relocate?*': { value: 'Yes', evidence: [] } })
  assert.equal((await unsupported.generate(candidate, position(), form)).missing.length, 1)
})

test('intake preserves PDF bytes and confirmed overrides; missing fields remain missing', async () => fixture(async (store, root) => {
  const bytes = Buffer.from('%PDF-1.4 original')
  const result = await intakeCandidate({ id: 'cv-test', source: { read: async () => ({ bytes, fileName: 'Original.pdf' }) }, confirmed: { city: 'Barcelona' }, criteria: { titles: ['fullstack'] } }, { store, storageRoot: root, extractor: { extract: async () => ({ city: { value: 'Madrid', source: 'cv', evidence: 'PDF' } }) } })
  assert.deepEqual(await readFile(result.cv.path), bytes)
  assert.equal(result.facts.city.value, 'Barcelona'); assert.equal(result.facts.city.source, 'confirmed')
  assert.equal(result.facts.email, undefined)
}))
test('dry run never fills or submits; apply does not run intake/discovery', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }
  const result = await applyToPositions({ candidate, batchId: 'dry', positions: [position()], mode: 'dry-run', limit: 2 }, { store, adapters: [adapter(count)], answers })
  assert.equal(result.records[0].status, 'prepared'); assert.deepEqual(count, { fills: 0, submits: 0 })
}))
test('repeated intake preserves confirmed facts and imported history while accepting explicit corrections', async () => fixture(async (store, root) => {
  const source = { read: async () => ({ bytes: Buffer.from('%PDF-1.4 newer'), fileName: 'new.pdf' }) }
  await store.saveCandidate({ ...candidate, facts: { city: { value: 'Barcelona', source: 'confirmed', evidence: 'User answer' } }, history: [{ company: 'Old', title: 'Senior', url: 'https://old.test/job', status: 'succeeded', confirmation: 'operator_reported' }] })
  const extractor = { extract: async () => ({ city: { value: 'Madrid', source: 'cv' as const, evidence: 'PDF' } }) }
  const input = { id: candidate.id, source, criteria: candidate.criteria }
  const kept = await intakeCandidate(input, { store, storageRoot: root, extractor })
  assert.equal(kept.facts.city.value, 'Barcelona'); assert.equal(kept.history.length, 1)
  const corrected = await intakeCandidate({ ...input, confirmed: { city: 'Valencia' } }, { store, storageRoot: root, extractor })
  assert.equal(corrected.facts.city.value, 'Valencia'); assert.equal(corrected.history.length, 1)
}))
test('live cap and immutable target list survive resume; successes are never resubmitted', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }; const deps = { store, adapters: [adapter(count)], answers }
  const input = { candidate, batchId: 'live', positions: [position(), position(2)], mode: 'live' as const, limit: 2 }
  await applyToPositions(input, deps); await applyToPositions({ ...input, resume: true }, deps)
  assert.equal(count.submits, 2)
  await assert.rejects(applyToPositions({ ...input, positions: [position(), position(3)], resume: true }, deps), /target/i)
  await assert.rejects(applyToPositions({ ...input, positions: [{ ...position(), applyUrl: position(3).applyUrl }, position(2)], resume: true }, deps), /URLs.*immutable/i)
  await assert.rejects(applyToPositions({ ...input, batchId: 'over', positions: [position(), position(2), position(3)] }, deps), /limit/i)
}))

test('four-target batch retains failed targets across resume and rejects a fifth or replacement', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, original = adapter(count)
  const partial: ApplicationAdapter = { ...original, open: async p => p.id === 'job-4' ? ({ ...await original.open(p), inspect: async () => ({ fields: [], text: '', url: p.url, closed: true, aiBan: false }) }) : original.open(p) }
  const input = { candidate, batchId: 'four', positions: [1, 2, 3, 4].map(position), mode: 'live' as const, limit: 4 }
  const deps = { store, adapters: [partial], answers }
  await applyToPositions(input, deps); await applyToPositions({ ...input, resume: true }, deps)
  assert.equal(count.submits, 3)
  await assert.rejects(applyToPositions({ ...input, positions: [1, 2, 3, 5].map(position), resume: true }, deps), /target/i)
  await assert.rejects(applyToPositions({ ...input, positions: [1, 2, 3, 4, 5].map(position), resume: true }, deps), /limit/i)
  const report = await generateReport({ candidateId: candidate.id, batchId: 'four' }, { store })
  assert.equal(report.summary.selected, 4); assert.equal(report.summary.confirmed, 3); assert.equal(report.summary.batches[0].passed, false)
}))

test('workbook cells survive discovery, application state and all report formats', async () => fixture(async store => {
  const workbook = { fileId: 'file-123', fileName: 'companies.xlsx', sheet: 'Companies', row: 22, companyCell: 'A22', careerCell: 'B22' }
  const source = { name: 'Algolia', url: 'https://company.test/careers', provenance: 'Companies!A22:B22', workbook }
  const [manifest] = await readSources({ entries: [source] })
  const found = await discoverPositions({ candidate, runId: 'provenance', sources: [manifest] }, { strategy: { name: 'websites', discover: async () => ({ positions: [{ ...position(), source: manifest }], audit: [] }) } })
  await applyToPositions({ candidate, batchId: 'provenance', positions: found.positions, mode: 'live', limit: 1 }, { store, adapters: [adapter({ fills: 0, submits: 0 })], answers })
  const report = await generateReport({ candidateId: candidate.id, batchId: 'provenance' }, { store })
  assert.ok(report.markdown.includes('Companies!A22')); assert.ok(report.markdown.includes('B22'))
  assert.ok(report.csv.includes('companyCell')); assert.ok(report.csv.includes('"A22"'))
  assert.deepEqual(report.results[0].position.source.workbook, workbook)
  const batch = (await store.batch(candidate.id, 'provenance'))!
  batch.records[0].evidence!.confirmation = 'operator_reported'; await store.saveBatch(batch)
  const reported = await generateReport({ candidateId: candidate.id, batchId: 'provenance' }, { store })
  assert.equal(reported.summary.confirmed, 0); assert.equal(reported.summary.candidateReported, 1); assert.equal(reported.summary.batches[0].passed, false)
}))
test('unknown outcomes and interrupted submission intents reconcile, never blindly click again', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }; const deps = { store, adapters: [adapter(count, { status: 'unknown', reason: 'unknown_outcome', detail: 'Timeout' })], answers }
  const input = { candidate, batchId: 'unknown', positions: [position()], mode: 'live' as const, limit: 2 }
  await applyToPositions(input, deps)
  const batch = (await store.batch(candidate.id, 'unknown'))!; batch.records[0].status = 'submitting'; await store.saveBatch(batch)
  await applyToPositions({ ...input, resume: true }, deps); assert.equal(count.submits, 1)
}))

test('a remote submission followed by a connection exception stays uncertain on resume', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, base = adapter(count)
  const disconnected: ApplicationAdapter = { ...base, open: async p => ({ ...await base.open(p), submit: async () => { count.submits++; throw Error('Remote accepted, connection closed before receipt') } }) }
  const input = { candidate, batchId: 'lost-response', positions: [position()], mode: 'live' as const, limit: 1 }
  const deps = { store, adapters: [disconnected], answers }
  assert.equal((await applyToPositions(input, deps)).records[0].status, 'unknown')
  assert.equal((await applyToPositions({ ...input, resume: true }, deps)).records[0].status, 'unknown')
  assert.equal(count.submits, 1); assert.equal(count.fills, 1)
}))
test('durable intent failure prevents submission; diagnostic failure does not duplicate success', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }; const save = store.saveBatch
  const broken = { ...store, saveBatch: async (batch: any) => { if (batch.records.some((r: any) => r.status === 'submitting')) throw Error('disk'); await save(batch) } }
  await assert.rejects(applyToPositions({ candidate, batchId: 'disk', positions: [position()], mode: 'live', limit: 2 }, { store: broken, adapters: [adapter(count)], answers }))
  assert.equal(count.submits, 0)
  const deps = { store: { ...store, event: async () => { throw Error('diagnostic disk') } }, adapters: [adapter(count)], answers }
  const input = { candidate, batchId: 'log', positions: [position()], mode: 'live' as const, limit: 2 }
  await applyToPositions(input, deps); await applyToPositions({ ...input, resume: true }, deps); assert.equal(count.submits, 1)
}))
test('candidate lock prevents concurrent application writers', async () => fixture(async store => {
  const release = await store.lock(candidate.id)
  await assert.rejects(store.lock(candidate.id), /lock/i)
  await release(); await (await store.lock(candidate.id))()
}))
test('manual completion of a blocked attempt is reconciled before refilling or submitting', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, original = adapter(count, { status: 'blocked', reason: 'captcha_required', detail: 'Human needed' })
  const input = { candidate, batchId: 'human', positions: [position()], mode: 'live' as const, limit: 2 }
  await applyToPositions(input, { store, adapters: [original], answers })
  const completed: ApplicationAdapter = { ...original, open: async p => ({ ...await original.open(p), reconcile: async () => ({ status: 'succeeded', detail: 'Human completed', manualAssistance: true, evidence: { url: p.url, observedAt: '', confirmation: 'captured', message: 'Thank you for applying' } }) }) }
  const result = await applyToPositions({ ...input, resume: true }, { store, adapters: [completed], answers })
  assert.equal(result.records[0].status, 'succeeded'); assert.equal(result.records[0].manualAssistance, true)
  assert.equal(result.records[0].reason, undefined)
  assert.equal(count.submits, 1); assert.equal(count.fills, 1)
}))

test('capturing a receipt clears the unknown reason and retains the original uncertain attempt', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, original = adapter(count, { status: 'unknown', reason: 'unknown_outcome', detail: 'Receipt wording not recognized' })
  const input = { candidate, batchId: 'receipt-reconciled', positions: [position()], mode: 'live' as const, limit: 2 }
  await applyToPositions(input, { store, adapters: [original], answers })
  const completed: ApplicationAdapter = { ...original, open: async p => ({ ...await original.open(p), reconcile: async () => ({ status: 'succeeded', detail: 'Receipt captured', evidence: { url: p.url, observedAt: '', confirmation: 'captured', message: 'Process completed; thank you for your job application' } }) }) }
  const result = await applyToPositions({ ...input, resume: true }, { store, adapters: [completed], answers })
  assert.equal(result.records[0].status, 'succeeded'); assert.equal(result.records[0].reason, undefined)
  assert.equal(result.records[0].outcomes?.[0].reason, 'unknown_outcome')
  assert.equal(count.submits, 1); assert.equal(count.fills, 1)
}))
test('failure to reopen an uncertain attempt preserves the unknown state', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, original = adapter(count, { status: 'unknown', reason: 'unknown_outcome', detail: 'Lost response' })
  const input = { candidate, batchId: 'lost', positions: [position()], mode: 'live' as const, limit: 2 }
  await applyToPositions(input, { store, adapters: [original], answers })
  const result = await applyToPositions({ ...input, resume: true }, { store, adapters: [{ ...original, open: async () => { throw Error('offline') } }], answers })
  assert.equal(result.records[0].status, 'unknown'); assert.equal(count.submits, 1)
}))
test('canonical URLs and company/title aliases deduplicate history', () => {
  assert.equal(positionId('https://jobs.ashbyhq.com/a/123/application?utm_source=x'), positionId('https://jobs.ashbyhq.com/a/123'))
  assert.equal(positionId('https://jobs.ashbyhq.com/a/123?embed=js'), positionId('https://jobs.ashbyhq.com/a/123'))
  assert.ok(isDuplicate(position(), [{ url: 'https://elsewhere.test/123', company: 'Company 1', title: 'Senior Fullstack Engineer', status: 'succeeded' }]))
})
test('employer application cooldown checks fresh durable history before uploading documents', async () => fixture(async store => {
  await store.saveCandidate({ ...candidate, history: [{ company: 'Company 1', title: 'Different old role', url: 'https://employer.test/old', status: 'succeeded', date: new Date().toISOString(), confirmation: 'operator_reported' }] })
  const count = { fills: 0, submits: 0 }, original = adapter(count)
  const guarded: ApplicationAdapter = { ...original, open: async p => { const session = await original.open(p); return { ...session, inspect: async () => ({ ...await session.inspect(), minimumDaysBetweenApplications: 15 }) } } }
  const result = await applyToPositions({ candidate, batchId: 'cooldown', positions: [position()], mode: 'live', limit: 2 }, { store, adapters: [guarded], answers })
  assert.equal(result.records[0].reason, 'employer_cooldown'); assert.deepEqual(count, { fills: 0, submits: 0 })
}))
test('outcome detection separates HTTP-200 application errors, robot denial, CAPTCHA and email codes', () => {
  assert.equal(classifyOutcome({ text: '', url: '', responses: ['{"errors":[{"message":"RECAPTCHA_SCORE_BELOW_THRESHOLD"}]}'] }).reason, 'robot_rejected')
  assert.equal(classifyOutcome({ text: 'Something went wrong', url: '', responses: ['captchaToken is invalid'] }).reason, 'captcha_required')
  assert.equal(classifyOutcome({ text: 'Security code for your application', url: '', responses: [] }).reason, 'email_verification_required')
  assert.equal(classifyOutcome({ text: 'A verification code was sent to candidate@example.test. To submit your application, enter the 8-character code to confirm you\u2019re a human.', url: '', responses: [] }).reason, 'email_verification_required')
  assert.equal(classifyOutcome({ text: 'Thank you for your interest in Adyen! We\u2019ve received your application and aim to get back to you within 5 working days.', url: '', responses: [] }).status, 'succeeded')
  assert.equal(classifyOutcome({ text: 'We\u2019ve received your request to create an account.', url: '', responses: [] }).status, 'unknown')
  assert.equal(classifyOutcome({ text: '', url: '', responses: ['{"errors":[{"message":"Missing entry for required field"}]}'] }).status, 'failed')
  assert.equal(classifyOutcome({ text: '', url: '', responses: ['{"status":200}'] }).status, 'unknown')
  assert.equal(classifyOutcome({ text: 'Experience is required. All required fields must be filled.', url: '', responses: [] }).status, 'unknown')
})

test('Taleo job receipt requires explicit completed application wording, not account completion', () => {
  const url = 'https://cognizant.taleo.net/careersection/candidateacquisition/flow.jsf'
  assert.equal(classifyOutcome({ text: 'Thank You\nProcess completed\nThank you for your job application. If your profile meets the requirements, a member of our team will contact you.', url, responses: [] }).status, 'succeeded')
  assert.equal(classifyOutcome({ text: 'Process completed. Thank you for registering your account.', url, responses: [] }).status, 'unknown')
  assert.equal(classifyOutcome({ text: 'Review and Submit. Thank you for your job application.', url, responses: [] }).status, 'unknown')
})
test('website crawl follows careers/pagination and audits a failed page as partial', async () => {
  const source = { name: 'Company', url: 'https://company.test/' }; const seen: string[] = []
  const strategy = createWebsiteStrategy({ reader: { read: async url => {
    seen.push(url)
    if (url.endsWith('/next')) throw Error('offline')
    return { url, text: '', jobs: url.endsWith('/careers') ? [position()] : [], links: [{ text: url.endsWith('/careers') ? 'Next' : 'Careers', url: url.endsWith('/careers') ? 'https://company.test/next' : 'https://company.test/careers' }] }
  } } })
  const result = await discoverPositions({ candidate, runId: 'crawl', sources: [source] }, { strategy })
  assert.equal(seen.length, 3); assert.equal(result.audit[0].status, 'partial'); assert.equal(result.positions.length, 1)
})

test('malformed website jobs cannot erase valid results; every source checkpoints before final filtering', async () => {
  const source = { name: 'Company', url: 'https://company.test/careers' }, checkpoints: any[] = []
  const strategy = createWebsiteStrategy({ reader: { read: async url => ({ url, text: '', links: [], jobs: [
    { ...position(), title: undefined } as any,
    { ...position(2), company: undefined } as any,
    { ...position(3), url: 'javascript:alert(1)' }
  ] }) }, onSource: async (audit, positions) => { checkpoints.push({ audit, positions }) } })
  const result = await discoverPositions({ candidate, runId: 'malformed', sources: [source] }, { strategy })
  assert.equal(result.positions.length, 1); assert.equal(result.positions[0].company, 'Company')
  assert.equal(result.audit[0].status, 'partial'); assert.ok(result.audit[0].issues.some(issue => issue.includes('Malformed')))
  assert.equal(checkpoints.length, 1); assert.equal(checkpoints[0].positions.length, 1)
})

test('verified listing seeds retain the original company source and workbook coordinates', async () => {
  const source = { name: 'Company', url: 'https://company.test/careers', listingUrls: ['https://jobs.ashbyhq.com/company'], provenance: 'Companies!A2:B2' }, seen: string[] = []
  const strategy = createWebsiteStrategy({ reader: { read: async url => { seen.push(url); return { url, text: '', links: [], jobs: url === source.url ? [] : [position()] } } } })
  const result = await discoverPositions({ candidate, runId: 'seeds', sources: [source] }, { strategy })
  assert.deepEqual(seen, [source.url, source.listingUrls[0]])
  assert.equal(result.positions[0].source.url, source.url); assert.equal(result.positions[0].source.provenance, source.provenance)
})
test('JSON source manifest preserves workbook provenance and exact source order', async () => {
  const sources = await readSources({ entries: [{ name: 'One', url: 'https://one.test', provenance: 'workbook row 2' }, { name: 'Two', url: 'https://two.test' }] })
  assert.equal(sources[0].provenance, 'workbook row 2'); assert.equal(sources.length, 2)
})
test('deduplication retains both company-list and dialog provenance', async () => {
  const first = { ...position(), source: { name: 'Company list', url: 'https://company.test/careers', provenance: 'row 3' } }
  const second = { ...position(), source: { name: 'Dialog', url: position().url }, description: 'A longer independently refreshed official job description.' }
  const result = await discoverPositions({ candidate, runId: 'dedup-sources', sources: [] }, { strategy: { name: 'combined', discover: async () => ({ positions: [first, second], audit: [] }) } })
  assert.equal(result.positions.length, 1); assert.equal(result.positions[0].sources?.length, 2)
  assert.ok(result.positions[0].sources?.some(s => s.provenance === 'row 3'))
})
test('standalone report distinguishes operator confirmation and robot failures; redacts secrets', async () => fixture(async store => {
  await store.saveCandidate({ ...candidate, history: [{ company: 'Prior employer', title: 'Senior Product', url: 'https://prior.test/job', status: 'succeeded', confirmation: 'operator_reported' }] })
  const evidence = { url: position().url, observedAt: '2026-01-01T10:00:00Z', message: 'Spam rejection', confirmation: 'captured' as const, screenshot: '/local/rejection.png' }
  await store.saveBatch({ id: 'report', candidateId: candidate.id, targetIds: ['job-1'], limit: 2, createdAt: '', updatedAt: '', records: [{ position: position(), status: 'blocked', reason: 'robot_rejected', detail: 'captchaToken=secret', attempt: 1, updatedAt: evidence.observedAt, evidence }] })
  const stored = (await store.batch(candidate.id, 'report'))!
  stored.records[0].preparation = { version: 1, contextHash: 'context', engine: 'fixture@1', formSignature: 'form', preparedAt: evidence.observedAt,
    fields: { secret: { signature: 'field', missing: false, answer: { value: 'PRIVATE_CHECKPOINT_VALUE', evidence: ['Private answer evidence'] } } } }
  await store.saveBatch(stored)
  const report = await generateReport({ candidateId: candidate.id }, { store })
  assert.equal(report.robotFailures.length, 1); assert.ok(!report.markdown.includes('captchaToken=secret'))
  assert.ok(report.markdown.includes('Candidate-reported success; no captured receipt'))
  assert.equal(report.summary.confirmed, 0); assert.equal(report.summary.batches[0].passed, false)
  assert.match(report.markdown, /diagnostic evidence only/)
  assert.doesNotMatch(report.csv, /"captured"/)
  assert.doesNotMatch(JSON.stringify(report.results), /PRIVATE_CHECKPOINT_VALUE|Private answer evidence/)
  assert.equal(report.results[0].preparation?.cachedQuestions, 1)
  assert.deepEqual(report.robotFailures[0].evidence, evidence); assert.equal(report.robotFailures[0].observedAt, evidence.observedAt)
  assert.deepEqual(report.failures[0].evidence, evidence); assert.equal(report.failures[0].updatedAt, evidence.observedAt)
}))

test('fill errors are diagnosed and prevent that submission while the next target continues', async () => fixture(async (store, root) => {
  const count = { fills: 0, submits: 0 }, original = adapter(count)
  const custom = { ...original, open: async (p: Position) => {
    const session = await original.open(p)
    return p.id === 'job-1' ? { ...session, fill: async () => { throw Error('Autocomplete unavailable\nverificationCode=123456') } } : session
  } }
  const result = await applyToPositions({ candidate, batchId: 'fill-errors', positions: [position(), position(2)], mode: 'live', limit: 2 }, { store, adapters: [custom], answers })
  assert.equal(result.records[0].status, 'blocked'); assert.equal(result.records[0].attempt, 0)
  assert.equal(result.records[1].status, 'succeeded'); assert.equal(count.submits, 1)
  const events = await readFile(join(root, 'logs', candidate.id, 'events.jsonl'), 'utf8')
  assert.ok(events.includes('form_preparation_failed')); assert.ok(!events.includes('123456'))
  assert.ok(!result.records[0].detail.includes('verificationCode'))
}))
test('public ATS extraction decodes encoded HTML without treating it as instructions', async () => {
  const result = await readAts('https://job-boards.greenhouse.io/fixture', async () => new Response(JSON.stringify({ jobs: [{ id: 1, title: 'Senior Engineer', content: '&lt;p&gt;Build React &amp; Node&lt;/p&gt;', location: { name: 'Spain' } }] })) as never)
  assert.equal(result!.jobs[0].description, 'Build React & Node')
  assert.equal(result!.jobs[0].url, 'https://job-boards.greenhouse.io/fixture/jobs/1')
})
test('redaction covers nested credentials and JSON-shaped diagnostic strings', () => {
  const redirect=redact('Blocked https://auth.test/login?session_redirect=private-flow&state=private-state')
  assert.doesNotMatch(redirect,/private-flow|private-state/)
  assert.match(redirect,/https:\/\/auth.test\/login/)
  assert.equal(redact('https://jobs.test/job?id=123'), 'https://jobs.test/job?id=123')
  assert.doesNotMatch(redact('https://jobs.test/?__cf_chl_rt_tk=private-challenge'),/private-challenge/)
  const result = JSON.stringify(redact({ authorization: 'Bearer secret', message: '{"verificationCode":"654321","captchaToken":"hidden"}', nested: { cookie: 'private' } }))
  for (const secret of ['secret', '654321', 'hidden', 'private']) assert.ok(!result.includes(secret))
})
test('a later challenge cannot turn an uncertain submission into permission to submit again', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, original = adapter(count, { status: 'unknown', reason: 'unknown_outcome', detail: 'Connection lost after click' })
  const input = { candidate, batchId: 'challenge-after-unknown', positions: [position()], mode: 'live' as const, limit: 2 }
  await applyToPositions(input, { store, adapters: [original], answers })
  const challenge: ApplicationAdapter = { ...original, open: async p => ({ ...await original.open(p), reconcile: async () => ({ status: 'blocked', reason: 'captcha_required', detail: 'Challenge visible' }) }) }
  await applyToPositions({ ...input, resume: true }, { store, adapters: [challenge], answers })
  const result = await applyToPositions({ ...input, resume: true }, { store, adapters: [challenge], answers })
  assert.equal(result.records[0].status, 'unknown'); assert.equal(count.submits, 1)
}))
test('manual submission handoff writes intent without clicking and preserves previous robot evidence', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, original = adapter(count, { status: 'blocked', reason: 'robot_rejected', detail: 'Rejected as spam' })
  const input = { candidate, batchId: 'manual-submit', positions: [position()], mode: 'live' as const, limit: 2 }
  await applyToPositions(input, { store, adapters: [original], answers })
  const result = await applyToPositions({ ...input, resume: true, manualSubmit: true }, { store, adapters: [original], answers })
  assert.equal(count.submits, 1); assert.equal(result.records[0].status, 'submitting'); assert.equal(result.records[0].manualAssistance, true)
  const report = await generateReport({ candidateId: candidate.id }, { store })
  assert.equal(report.robotFailures.length, 1); assert.equal(report.summary.confirmed, 0)
}))
test('changed fit or missing adapters never erase an uncertain submission checkpoint', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, original = adapter(count, { status: 'unknown', reason: 'unknown_outcome', detail: 'Lost response' })
  const input = { candidate, batchId: 'changed-fit', positions: [position()], mode: 'live' as const, limit: 2 }
  await applyToPositions(input, { store, adapters: [original], answers })
  const changed = { ...position(), fit: { decision: 'review' as const, reasons: ['Re-review'], evidence: [] } }
  const result = await applyToPositions({ ...input, positions: [changed], resume: true }, { store, adapters: [], answers })
  assert.equal(result.records[0].status, 'unknown')
  await applyToPositions({ ...input, resume: true }, { store, adapters: [original], answers })
  assert.equal(count.submits, 1)
}))
test('pre-application email verification is classified before any candidate upload', async () => fixture(async store => {
  const count = { fills: 0, submits: 0 }, original = adapter(count)
  const guarded: ApplicationAdapter = { ...original, open: async p => { const session = await original.open(p); return { ...session, inspect: async () => ({ ...await session.inspect(), gate: 'email_verification_required' }) } } }
  const result = await applyToPositions({ candidate, batchId: 'email-gate', positions: [position()], mode: 'live', limit: 2 }, { store, adapters: [guarded], answers })
  assert.equal(result.records[0].reason, 'email_verification_required'); assert.deepEqual(count, { fills: 0, submits: 0 })
}))
