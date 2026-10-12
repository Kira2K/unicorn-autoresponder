import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  activateBinding,
  buildEngineArtifact,
  evaluateEngine,
  loadArtifact,
  loadBinding,
  rollbackBinding,
  validateEngineCandidate,
  writeArtifact
} from '../vacancy_collection/engines/index.ts'
import type { EngineFixture, EngineInput, EngineParseResult } from '../vacancy_collection/engines/index.ts'
import { buildCampaignScope } from '../stack_catalog/campaign.ts'
import { classifyVacancies } from '../stack_classification/index.ts'
import { seedReviewedCache } from '../stack_classification/reuse.ts'
import { loadSelectionRules } from '../stack_classification/rules.ts'

const limits = { timeoutMs: 500, memoryLimitBytes: 16 * 1024 * 1024 }
const input: EngineInput = {
  sourceId: 'fixture-source',
  url: 'https://careers.example.test/jobs',
  text: 'Open jobs',
  links: [{ text: 'Senior Backend Engineer', url: 'https://careers.example.test/jobs/1' }],
  jobs: []
}
const description = 'Responsibilities: build and operate production backend services for customers. Requirements: professional software engineering experience and reliable delivery.'
const parsed: EngineParseResult = {
  url: input.url,
  text: `Senior Backend Engineer\n${description}`,
  links: input.links,
  jobs: [{ title: 'Senior Backend Engineer', location: 'Remote', description, url: input.links[0].url, applyUrl: input.links[0].url }]
}
const parseCode = `function parse(input) { return ${JSON.stringify(parsed)} }`
const liveEvidence = { coverage: 'complete' as const, paginationComplete: true, explicitlyEmpty: false }
const fixture: EngineFixture = {
  name: 'public-listing', input,
  expected: { kind: 'parse', minimumJobs: 1, jobUrls: [input.links[0].url], substantiveText: ['Responsibilities: build'] }
}

test('generated engines receive only JSON and return declarative plans', async () => {
  const code = `function plan(input) {
    if (typeof process !== "undefined" || typeof require !== "undefined" || typeof fetch !== "undefined") throw Error("host leaked")
    input.links.push({text:"mutate",url:"https://evil.test"})
    return {entryUrls:[input.url],reads:[{url:input.links[0].url,steps:[{operation:"click",role:"button",name:"Show all jobs"}]}]}
  }`
  await assert.rejects(evaluateEngine(code, input, limits), /read only|not extensible|object is not extensible|execution_failed/i)
  const result = await evaluateEngine(code.replace('input.links.push({text:"mutate",url:"https://evil.test"})', ''), input, limits)
  assert.equal(result.kind, 'plan')
  if (result.kind === 'plan') assert.deepEqual(result.value.entryUrls, [input.url])
})

test('runtime rejects host-shaped output, forbidden navigation and nontermination', async () => {
  await assert.rejects(evaluateEngine(`function plan(){return {entryUrls:["https://linkedin.com/jobs/1"]}}`, input, limits), /LinkedIn|forbidden/i)
  await assert.rejects(evaluateEngine(`function plan(){return {entryUrls:[${JSON.stringify(input.url)}],sourceId:"another"}}`, input, limits), /unexpected_field:sourceId/)
  await assert.rejects(evaluateEngine(`function parse(){return {...${JSON.stringify(parsed)},jobs:[{...${JSON.stringify(parsed.jobs[0])},companyId:"9"}]}}`, input, limits), /unexpected_field:companyId/)
  await assert.rejects(evaluateEngine(`function parse(){return {...${JSON.stringify(parsed)},completeListing:true}}`, input, limits), /unexpected_field:completeListing/)
  await assert.rejects(evaluateEngine('function plan(){ while(true){} }', input, { ...limits, timeoutMs: 20 }), /timeout/)
})

test('runtime applies a guest memory ceiling', async () => {
  await assert.rejects(
    evaluateEngine('function plan(){ return new ArrayBuffer(32 * 1024 * 1024) }', input, { timeoutMs: 2_000, memoryLimitBytes: 4 * 1024 * 1024 }),
    /memory_limit/
  )
})

test('artifact validation uses independent fixtures and complete live evidence', async () => {
  const artifact = await buildEngineArtifact({ id: 'fixture-parser', version: 1, code: parseCode, sourceIds: [input.sourceId], createdAt: new Date().toISOString() }, [fixture], limits)
  const validation = await validateEngineCandidate({ artifact, sourceId: input.sourceId, fixtures: [fixture], liveResult: parsed, liveEvidence }, limits)
  assert.equal(validation.sourceId, input.sourceId)
  await assert.rejects(validateEngineCandidate({ artifact, sourceId: 'other-source', fixtures: [fixture], liveResult: parsed, liveEvidence }, limits), /source_not_bound/)
  await assert.rejects(validateEngineCandidate({ artifact, sourceId: input.sourceId, fixtures: [{ ...fixture, expected: { ...fixture.expected, jobUrls: ['https://careers.example.test/jobs/missing'] } }], liveResult: parsed, liveEvidence }, limits), /fixture_job_url_missing/)
  await assert.rejects(validateEngineCandidate({ artifact, sourceId: input.sourceId, fixtures: [fixture], liveResult: parsed, liveEvidence: { coverage: 'partial', paginationComplete: false, explicitlyEmpty: false } }, limits), /not_complete/)
  await assert.rejects(validateEngineCandidate({ artifact, sourceId: input.sourceId, fixtures: [fixture], liveResult: { ...parsed, jobs: [{ ...parsed.jobs[0], description: 'short' }] }, liveEvidence }, limits), /description_too_short/)
})

test('registry stores immutable artifacts, isolates source bindings and rolls back', async () => {
  const root = await mkdtemp(join(tmpdir(), 'collection-engines-'))
  const first = await buildEngineArtifact({ id: 'fixture-parser', version: 1, code: parseCode, sourceIds: [input.sourceId], createdAt: new Date().toISOString() }, [fixture], limits)
  const firstValidation = await validateEngineCandidate({ artifact: first, sourceId: input.sourceId, fixtures: [fixture], liveResult: parsed, liveEvidence }, limits)
  const firstPath = await writeArtifact(root, first)
  assert.deepEqual(await loadArtifact(root, first), first)
  await assert.rejects(activateBinding(root, first, { ...firstValidation }), /requires_current_process_validation/)
  const firstBinding = await activateBinding(root, first, firstValidation)
  assert.equal(firstBinding.previous, undefined)

  const secondCode = `${parseCode}\n// independently revised engine`
  const second = await buildEngineArtifact({ id: 'fixture-parser', version: 2, code: secondCode, sourceIds: [input.sourceId], createdAt: new Date().toISOString() }, [fixture], limits)
  const secondValidation = await validateEngineCandidate({ artifact: second, sourceId: input.sourceId, fixtures: [fixture], liveResult: parsed, liveEvidence }, limits)
  await writeArtifact(root, second)
  const secondBinding = await activateBinding(root, second, secondValidation)
  assert.equal(secondBinding.previous?.sha256, first.sha256)
  assert.equal((await rollbackBinding(root, input.sourceId)).sha256, first.sha256)
  assert.equal((await loadBinding(root, input.sourceId))?.sha256, first.sha256)

  const tampered = { ...first, code: `${first.code}\n// changed` }
  await assert.rejects(writeArtifact(root, tampered), /hash_mismatch/)
  assert.equal(JSON.parse(await readFile(firstPath, 'utf8')).sha256, first.sha256)
})

test('incomplete company boilerplate stays review-only and does not break reviewed cache seeding', async () => {
  const rules = await loadSelectionRules()
  const scope = buildCampaignScope({ database: 'fixture', stacks: [{ id: '2', name: 'Python', description: 'Middle/senior Python backend' }], students: [{ studentId: 'student', stackId: '2' }] })
  const source = { name: 'Fixture', url: input.url, database: { sourceId: input.sourceId, companyId: 'company', applicationRoute: 'standard_workflow' as const } }
  const boilerplate = 'ABOUT THE COMPANY. As a fast-growing, award-winning company, we offer a vibrant work culture. Join us and unlock opportunities for growth across our international offices.'
  const position = { id: 'boilerplate', company: source.name, title: 'Senior Python Engineer', description: boilerplate, location: 'Remote', url: input.links[0].url, applyUrl: input.links[0].url, retrievedAt: new Date().toISOString(), source }
  const collection = { version: 1 as const, runId: 'boilerplate', sources: [source], positions: [position], audit: [{ source, status: 'complete' as const, pages: [source.url], found: 1, issues: [] }], createdAt: new Date().toISOString(), scope }
  const eligible = { decision: 'eligible' as const, reasons: ['Injected positive must be ignored'], evidence: [position.title] }
  const classified = await classifyVacancies({ collection, selectionRules: rules, assessmentProvenance: { origin: 'assistant_session', reviewedBy: 'fixture', reviewedAt: new Date().toISOString(), reviewHash: 'fixture' } }, { assessGlobal: async () => eligible, assess: async () => eligible })
  assert.deepEqual(classified.groups['stack-2'].matchedIds, [])
  assert.deepEqual(classified.groups['stack-2'].reviewIds, [position.id])
  assert.doesNotThrow(() => seedReviewedCache(classified, rules, scope.stacks))
})
