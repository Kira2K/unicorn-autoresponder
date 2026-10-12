import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectVacancies } from '../vacancy_collection/index.ts'
import { classifyVacancies, assertCollectionReady } from '../stack_classification/index.ts'
import { javaStack, validateStackProfiles } from '../stack_catalog/index.ts'
import { applyToPositions } from '../applications/index.ts'
import { createFileStore } from '../infrastructure/store.ts'
import { positionId } from '../infrastructure/identity.ts'
import { isLinkedInUrl } from '../infrastructure/navigation-policy.ts'
import { matchCandidatePositions } from '../candidate_matching/index.ts'
import { intakeCandidate } from '../candidate_intake/index.ts'
import { createWebsiteStrategy } from '../vacancy_collection/discover.ts'
import type { Candidate, Position, Source, DiscoveryStrategy, ApplicationAdapter } from '../types.ts'
import type { StackProfile } from '../stack_catalog/index.ts'

const sources: Source[] = [{ name: 'First', url: 'https://first.test/jobs' }, { name: 'Last', url: 'https://last.test/jobs' }]
const job = (source: Source, title: string, description: string): Position => {
  const url = source.url + '/' + encodeURIComponent(title)
  return { id: positionId(url), company: source.name, title, description, location: 'Spain', url, applyUrl: url, source, retrievedAt: '2026-01-01' }
}
const java = job(sources[0], 'Senior Java Backend Engineer', 'Build backend services with Java and Spring Boot.')
const react = job(sources[0], 'Senior Frontend Engineer', 'Build frontend interfaces with React.')
const middle = job(sources[1], 'Middle Java Backend Engineer', 'Develop backend services with Java and Spring Framework.')
const frontend: StackProfile = { id: 'frontend', name: 'Frontend', seniorities: ['senior'], roleTerms: ['frontend'], technologyGroups: [['React']] }
function strategy(positions = [java, react, middle]): DiscoveryStrategy {
  return { name: 'fixture', discover: async manifest => ({ positions, audit: manifest.map(source => ({ source, status: 'complete', pages: [source.url], found: positions.filter(p => p.source.url === source.url).length, issues: [] })) }) }
}
async function classified() { return classifyVacancies({ collection: await collectVacancies({ runId: 'all-companies', sources }, { strategy: strategy() }), stacks: [javaStack, frontend] }) }

test('target readiness permits accepted vacancies beside pending peers without weakening integrity or coverage', async () => {
  const collection = await collectVacancies({ runId: 'target-readiness', sources }, { strategy: strategy() })
  const result = await classifyVacancies({ collection, stacks: [javaStack, frontend], evaluation: { pendingIds: [react.id], hits: 0, calls: 0, records: {} } })
  assert.equal(result.readyForApplications, false)
  assert.throws(() => assertCollectionReady(result), /collection_changed/)
  assert.doesNotThrow(() => assertCollectionReady(result, [java.id]))
  for (const id of [react.id, 'unknown']) assert.throws(() => assertCollectionReady(result, [id]), /application_target_assessment_required/)
  const changed = structuredClone(result); changed.collection.positions[0].description = 'tampered'
  assert.throws(() => assertCollectionReady(changed, [java.id]), /collection_changed/)
  const unfinished = structuredClone(result); unfinished.collection.audit[0].terminal = false
  assert.throws(() => assertCollectionReady(unfinished, [java.id]), /collection_incomplete/)
})

test('collection completes the entire manifest before classification; different stacks at one company survive', async () => {
  let finish!: () => void; let done = false
  const delayed: DiscoveryStrategy = { name: 'delayed', discover: async manifest => { await new Promise<void>(resolve => { finish = resolve }); return strategy().discover(manifest) } }
  const pending = collectVacancies({ runId: 'all', sources }, { strategy: delayed }).then(value => { done = true; return value })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(done, false); finish()
  const collection = await pending
  assert.equal(collection.positions.length, 3); assert.equal(collection.audit.length, 2)
  const result = await classifyVacancies({ collection, stacks: [javaStack, frontend] })
  assert.deepEqual(result.groups.java.matchedIds, [java.id, middle.id])
  assert.deepEqual(result.groups.frontend.matchedIds, [react.id])
  assert.equal(result.readyForApplications, true)
})

test('terminal source gaps allow verified roles; missing source outcomes still block applications', async () => {
  for (const status of ['partial', 'unavailable', 'missing'] as const) {
    const discovery = strategy(); const original = discovery.discover
    discovery.discover = async manifest => { const result = await original(manifest); if (status === 'missing') result.audit.pop(); else result.audit[1].status = status; return result }
    const result = await classifyVacancies({ collection: await collectVacancies({ runId: 'partial', sources }, { strategy: discovery }), stacks: [javaStack] })
    assert.equal(result.readyForApplications, status !== 'missing')
    if (status === 'missing') assert.throws(() => assertCollectionReady(result), /collection_incomplete/)
    else assert.doesNotThrow(() => assertCollectionReady(result))
  }
})

test('stack catalog requires explicit policies; Java does not mean Javascript, junior, QA or optional Spring', async () => {
  assert.ok(validateStackProfiles([{ id: 'node', name: 'NODE' }]).length)
  const rows = [job(sources[0], 'Senior Backend Engineer', 'Develop backend services in Javascript with Express.'),
  job(sources[0], 'Junior Java Backend Engineer', 'Build backend Java Spring Boot services.'),
  job(sources[0], 'Senior Java QA Engineer', 'Test backend Java Spring Boot services.'),
  job(sources[0], 'Senior Java Backend Engineer', 'Build backend services in Java. Spring Boot is optional.')]
  const result = await classifyVacancies({ collection: await collectVacancies({ runId: 'rules', sources }, { strategy: strategy(rows) }), stacks: [javaStack] })
  assert.equal(result.groups.java.matchedIds.length, 0)
  const missing = await classifyVacancies({ collection: result.collection, stacks: [{ id: 'node', name: 'NODE' }] })
  assert.equal(missing.readyForApplications, false); assert.throws(() => assertCollectionReady(missing), /stack_configuration_required/)
})

test('a vacancy may match multiple stacks and duplicate URLs preserve source provenance', async () => {
  const duplicate = { ...java, source: sources[1] }
  const collection = await collectVacancies({ runId: 'dedup', sources }, { strategy: strategy([java, duplicate]) })
  assert.equal(collection.positions.length, 1); assert.equal(collection.positions[0].sources?.length, 2)
  const result = await classifyVacancies({ collection, stacks: [javaStack, { ...javaStack, id: 'jvm', name: 'JVM' }] })
  assert.deepEqual(result.groups.java.matchedIds, result.groups.jvm.matchedIds)
})

test('application boundary blocks incomplete collection, wrong student stack and altered positions before opening forms', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stack-pipeline-')); let opened = 0
  const candidate: Candidate = { id: 'test', stackIds: ['java'], cv: { path: '', sha256: '', fileName: 'cv.pdf' }, facts: {}, criteria: { titles: ['backend'] }, history: [], createdAt: '' }
  const store = createFileStore(root, join(root, 'logs')); await store.saveCandidate(candidate)
  const adapter: ApplicationAdapter = { name: 'fixture', supports: () => true, open: async () => { opened++; return { inspect: async () => ({ fields: [], text: '', url: java.url, closed: false, aiBan: false }), fill: async () => { }, verify: async () => [], submit: async () => { throw Error('dry run only') }, reconcile: async () => ({ status: 'unknown', detail: 'No receipt' }), close: async () => { } } } }
  try {
    const collection = await classified(), positions = [{ ...collection.collection.positions.find(p => p.id === java.id)!, fit: { decision: 'eligible' as const, reasons: [], evidence: ['Confirmed match'] } }]
    const input = { candidate, batchId: 'java', positions, collection, stackId: 'java', mode: 'dry-run' as const, limit: 1 }
    const deps = { store, adapters: [adapter], answers: { generate: async () => ({ values: {}, missing: [] }) }, restrictions: { load: async () => ({ studentId: candidate.id, complete: true, checkedAt: new Date().toISOString(), rules: [] }) } }
    await assert.rejects(applyToPositions({ ...input, collection: undefined as any }, deps), /collection_required/)
    await assert.rejects(applyToPositions({ ...input, candidate: { ...candidate, stackIds: ['frontend'] } }, deps), /candidate_stack_mismatch/)
    await assert.rejects(applyToPositions({ ...input, positions: [{ ...positions[0], applyUrl: 'https://different.test/apply' }] }, deps), /collection_position_changed/)
    const incomplete = structuredClone(collection); incomplete.collection.audit[1].terminal = false
    await assert.rejects(applyToPositions({ ...input, collection: incomplete }, deps), /collection_incomplete|collection_changed/)
    assert.equal(opened, 0)
    const result = await applyToPositions(input, deps); assert.equal(result.records[0].status, 'prepared'); assert.equal(opened, 1)
    assert.equal(result.collection?.stackId, 'java')
    const other = await classifyVacancies({ collection: { ...collection.collection, runId: 'another-run' }, stacks: [javaStack, frontend] })
    await assert.rejects(applyToPositions({ ...input, collection: other, resume: true }, deps), /collection.*immutable/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('LinkedIn and its short links are forbidden, while unrelated domains are not', () => {
  for (const url of ['https://linkedin.com/jobs/1', 'https://uk.linkedin.com/in/person', 'https://www.linkedin.com./company/x', 'https://lnkd.in/test']) assert.equal(isLinkedInUrl(url), true)
  assert.equal(isLinkedInUrl('https://linkedin.com.example.test/jobs'), false)
})

test('student history filters matching only; shared stack collection is reusable by another student', async () => {
  const collection = await classified(), before = structuredClone(collection)
  const candidate: Candidate = { id: 'first', stackIds: ['java'], cv: { path: '', sha256: '', fileName: 'cv.pdf' }, facts: {}, criteria: { titles: ['backend'] }, history: [{ url: java.url, company: java.company, title: java.title, status: 'succeeded', confirmation: 'captured' }], createdAt: '' }
  const restrictions = { load: async (c: Candidate) => ({ studentId: c.id, complete: true, checkedAt: new Date().toISOString(), rules: [] }) }
  const first = await matchCandidatePositions({ candidate, collection, stackId: 'java' }, { restrictions })
  const second = await matchCandidatePositions({ candidate: { ...candidate, id: 'second', history: [] }, collection, stackId: 'java' }, { restrictions })
  assert.equal(first.positions.find(p => p.id === java.id)?.fit?.decision, 'excluded')
  assert.equal(second.positions.find(p => p.id === java.id)?.fit?.decision, 'eligible')
  assert.deepEqual(collection, before)
})

test('intake preserves explicit student stack assignment unless a replacement is supplied', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stack-intake-'))
  try {
    const deps = { store: createFileStore(root, join(root, 'logs')), storageRoot: root, extractor: { extract: async () => ({}) } }
    const input = { id: 'student', source: { read: async () => ({ bytes: Buffer.from('%PDF-1.4 fixture'), fileName: 'cv.pdf' }) }, criteria: { titles: ['backend'] } }
    assert.deepEqual((await intakeCandidate({ ...input, stackIds: ['java', 'java'] }, deps)).stackIds, ['java'])
    assert.deepEqual((await intakeCandidate(input, deps)).stackIds, ['java'])
    assert.deepEqual((await intakeCandidate({ ...input, stackIds: [] }, deps)).stackIds, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('website collection visits every company with at most three workers, without a candidate filter', async () => {
  const manifest = Array.from({ length: 12 }, (_, i) => ({ name: `Company ${i}`, url: `https://company-${i}.test/jobs` }))
  let active = 0, maximum = 0
  const visited: string[] = []
  const strategy = createWebsiteStrategy({
    concurrency: 20, reader: {
      read: async url => {
        maximum = Math.max(maximum, ++active)
        await new Promise(resolve => setTimeout(resolve, 5))
        visited.push(url); active--
        const source = manifest.find(source => source.url === url)!
        return { url, text: '', links: [], jobs: [job(source, 'Senior Data Analyst', 'Responsibilities: analyze business data with SQL, build reporting dashboards, investigate data quality and work with product teams to explain results.')] }
      }
    }
  })
  const collection = await collectVacancies({ runId: 'whole-manifest', sources: manifest }, { strategy })
  assert.equal(maximum, 3)
  assert.equal(visited.length, 12)
  assert.equal(collection.positions.length, 12)
  assert.deepEqual(collection.audit.map(audit => audit.source.name), manifest.map(source => source.name))
  assert.ok(collection.audit.every(audit => audit.status === 'complete'))
})
