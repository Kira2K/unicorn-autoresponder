import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applicationStatus } from '../application_workflow/status.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'
import { createHash } from 'node:crypto'
import { applicationOutput } from '../application_workflow/output.ts'
import { readTailoringStates } from '../application_workflow/tailoring-status.ts'
import { tailoringInput } from '../application_preparation/tailoring.ts'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('age is checked before preparation but never hides uncertain submission reconciliation', async () => {
  const rules = await loadSelectionRules()
  const batch: any = { records: [
    { position: { id: 'old', description: 'Python backend', publishedAt: '2020-01-01' }, status: 'prepared', attempt: 0, answers: { missing: [] } },
    { position: { id: 'unknown', description: 'Python backend', publishedAt: '2020-01-01' }, status: 'unknown', attempt: 1 }
  ] }
  const status = applicationStatus({ candidateId: 'c', batchId: 'b', positionIds: ['old', 'unknown'] }, batch, rules, rules)
  assert.deepEqual(status.targets.map(t => t.next), ['exclude_expired_posting', 'reconcile_existing_attempt'])
  assert.equal(status.targets[0].publication?.status, 'expired')
})

test('compact checkpoint distinguishes reconciliation, review, tailoring and fresh preparation without private answers', async () => {
  const rules = await loadSelectionRules()
  const batch: any = { records: [
    { position: { id: 'a' }, status: 'unknown', attempt: 1 },
    { position: { id: 'b' }, status: 'submitting', attempt: 2 },
    { position: { id: 'c' }, status: 'prepared', attempt: 0, answers: { values: { secret: 'private answer' }, missing: [] } },
    { position: { id: 'd' }, status: 'blocked', attempt: 0, answers: { missing: [] }, preparedCv: { path: 'tailored.pdf', sha256: 'hash' } }
  ] }
  const input = { candidateId: 'student', batchId: 'batch', positionIds: ['a', 'b', 'c', 'd'], campaign: { id: 'test' } }
  const result = applicationStatus(input, batch, rules, rules)
  assert.deepEqual(result.targets.map(r => r.next), ['reconcile_existing_attempt', 'reconcile_existing_attempt', 'tailor_once', 'review_saved_pdf'])
  assert.doesNotMatch(JSON.stringify(result), /private answer/)
  const changed = { ...rules, text: rules.text.replace('## Rules\n', '## Rules\nNew semantic policy.\n') }; changed.sha256 = createHash('sha256').update(changed.text).digest('hex')
  const stale = applicationStatus(input, batch, changed, rules)
  assert.equal(stale.targets[0].next, 'reconcile_existing_attempt')
  assert.equal(stale.rules.semanticTextChanged, true)
  assert.equal(stale.targets[2].next, 'revalidate_saved_description')
})

test('stdout keeps exact unresolved choices and artifact reference without private answers or full evidence', async () => {
  const rules = await loadSelectionRules()
  const field = { key: 'work_auth', label: 'Work authorization', type: 'select', required: true, options: ['Yes, unrestricted', 'No, sponsorship required'] }
  const batch: any = { id: 'batch', records: [{ position: { id: 'role', title: 'Engineer' }, status: 'blocked', reason: 'missing_answers', attempt: 0,
    detail: 'long diagnostic', answers: { values: { name: { value: 'private answer' } }, missing: [field] },
    preparedCv: { path: 'tailored.pdf', sha256: 'abc', signedUrl: 'private link' }, evidence: { message: 'private evidence' } }] }
  const status = applicationStatus({ candidateId: 'candidate', batchId: 'batch', positionIds: ['role'] }, batch, rules, rules)
  assert.deepEqual(status.targets[0].missingQuestions, [field])
  const compact = applicationOutput(batch, 'report.md')
  assert.deepEqual(compact.records[0].missing, [field])
  assert.equal(compact.records[0].cv?.path, 'tailored.pdf')
  assert.doesNotMatch(JSON.stringify(compact), /private answer|private link|private evidence|long diagnostic/)
  const verbose: any = applicationOutput(batch, 'report.md', true)
  assert.equal(verbose.records[0].detail, 'long diagnostic')
  assert.equal(verbose.records[0].evidence?.message, 'private evidence')
})

test('compact stdout and SQL status share safe next actions without an extra status read', async () => {
  const rules = await loadSelectionRules()
  const field = { key: 'choice', label: 'Choice', type: 'select', required: true, options: ['A', 'B'] }
  const records: any[] = [
    { position: { id: 'missing' }, status: 'blocked', reason: 'input_required', detail: 'Missing confirmed answers', attempt: 0, answers: { missing: [field] } },
    { position: { id: 'tailor' }, status: 'prepared', detail: '', attempt: 0, answers: { missing: [] } },
    { position: { id: 'apply' }, status: 'prepared', detail: '', attempt: 0, answers: { missing: [] }, preparedCv: { path: 'ready.pdf', sha256: 'ready' } },
    { position: { id: 'review' }, status: 'blocked', reason: 'input_required', detail: 'test_cv_review_required', attempt: 0, answers: { missing: [] }, preparedCv: { path: 'review.pdf', sha256: 'review' } },
    { position: { id: 'restricted' }, status: 'blocked', reason: 'restriction_applies', detail: 'Restriction applies', attempt: 0, answers: { missing: [] } },
    { position: { id: 'unsupported' }, status: 'blocked', reason: 'unsupported_form', detail: 'Manual handoff', attempt: 0, answers: { missing: [] } },
    { position: { id: 'fit' }, status: 'blocked', reason: 'input_required', detail: 'Vacancy fit needs explicit evidence-based review.', attempt: 0, answers: { missing: [] } },
    { position: { id: 'unknown' }, status: 'unknown', reason: 'unknown_outcome', detail: '', attempt: 1 },
  ]
  const batch: any = { id: 'batch', records }
  const input = { candidateId: 'candidate', batchId: 'batch', positionIds: records.map(r => r.position.id), campaign: { id: 'test' } }
  const expected = ['prepare_changed_answers', 'tailor_once', 'review_saved_pdf', 'review_saved_pdf', 'resolve_blocker', 'resolve_blocker', 'resolve_blocker', 'reconcile_existing_attempt']
  assert.deepEqual(applicationStatus(input, batch, rules, rules).targets.map(t => t.next), expected)
  assert.deepEqual(applicationOutput(batch, 'report.md', false, { campaign: input.campaign }).records.map(r => r.next), expected)
  assert.equal(applicationOutput(batch, 'report.md').records[2].next, 'apply_saved_artifact')
})

test('selected bound tailoring journal distinguishes consumed request from recoverable result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tailoring-status-'))
  const input: any = { candidateId: 'candidate', studentId: '4', batchId: 'batch', positionIds: ['role'], tailoringPolicy: { id: 'approved', approvedAt: '2026-10-07T00:00:00Z', approvalReference: 'test' } }
  const candidate: any = { id: 'candidate', databaseClientId: '4', cv: { sha256: 'original' } }
  const position: any = { id: 'role', description: 'Complete role description' }
  const batch: any = { records: [{ position, status: 'prepared', attempt: 0, detail: '', answers: { missing: [] } }] }
  const directory = join(root, 'candidates', 'candidate', 'tailored', 'batch')
  const path = join(directory, 'role.json')
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(join(root, 'candidates', 'candidate', 'candidate.json'), JSON.stringify(candidate))
    const binding = tailoringInput({ candidate, position, batchId: 'batch', policy: input.tailoringPolicy, directory })
    const journal = { binding, status: 'generation_uncertain_or_failed', requests: 1, requestedAt: '2026-10-07T01:00:00Z', failure: { code: 'cv_tailoring_api_failed', status: 500, at: '2026-10-07T01:00:01Z', body: 'private upstream response' } }
    await writeFile(path, JSON.stringify(journal))
    const rules = await loadSelectionRules()
    const consumed = await readTailoringStates(input, batch, root)
    assert.equal(applicationStatus(input, batch, rules, rules, consumed).targets[0].next, 'resolve_tailoring_failure')
    assert.equal(applicationStatus({ ...input, cvMode: 'original' }, batch, rules, rules, consumed).targets[0].next, 'apply_original_cv')
    batch.records[0].attempt = 1
    assert.equal(applicationStatus({ ...input, cvMode: 'original' }, batch, rules, rules, consumed).targets[0].next, 'reconcile_existing_attempt')
    batch.records[0].attempt = 0
    assert.doesNotMatch(JSON.stringify(consumed), /private upstream response/)
    assert.deepEqual(consumed.role.failure, { code: 'cv_tailoring_api_failed', status: 500, at: '2026-10-07T01:00:01Z' })
    await writeFile(path, JSON.stringify({ ...journal, status: 'result_received', resultUrl: 'https://private.example?token=secret' }))
    const recoverable = await readTailoringStates(input, batch, root)
    assert.equal(applicationStatus(input, batch, rules, rules, recoverable).targets[0].next, 'recover_tailoring_result')
    assert.doesNotMatch(JSON.stringify(recoverable), /private.example|secret/)
    await writeFile(path, JSON.stringify({ ...journal, binding: { ...binding, descriptionHash: 'changed' } }))
    await assert.rejects(readTailoringStates(input, batch, root), /tailoring_checkpoint_binding_mismatch/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
