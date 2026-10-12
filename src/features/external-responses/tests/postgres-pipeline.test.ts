import test from 'node:test'
import assert from 'node:assert/strict'
import { workflowFixture as runtimeFixture } from '../../company-client-management/tests/runtime-fixture.mts'
import { createReadSession } from '../../../integrations/postgres/read-session.mts'
import { writeTransaction } from '../../../integrations/postgres/working-session.mts'
import { buildCampaignScope } from '../stack_catalog/campaign.ts'
import { collectVacancies } from '../vacancy_collection/index.ts'
import { saveCollection, loadCollection } from '../vacancy_collection/postgres.ts'
import { classifyVacancies, assertCollectionReady } from '../stack_classification/index.ts'
import { selectionRules, assessGlobal } from './selection-fixture.ts'
import { saveClassification } from '../stack_classification/postgres.ts'
import { loadDatabaseSources } from '../company_sources/postgres.ts'
import { createPostgresStore } from '../infrastructure/postgres-store.ts'
import { generateReport } from '../reporting/index.ts'
import type { Candidate, Store, BatchState, Position } from '../types.ts'

test('accepted Telegram routes and company market persist in existing SQL JSON and reload without a browser', async () => {
  const f = await runtimeFixture()
  try {
    const read = createReadSession(f.pool, f.database), write = <T>(fn: any) => writeTransaction(f.pool, f.database, fn) as Promise<T>
    const catalog = await loadDatabaseSources(fn => read(s => fn(s, {} as any, {} as any)))
    const scope = buildCampaignScope({ database: f.database, stacks: [{ id: '5', name: 'Java', description: 'Java Spring backend' }], students: [{ studentId: '1', stackId: '5' }] })
    const source = catalog.sources[0], url = source.url + '/telegram-role'
    const position: Position = { id: '', company: source.name, title: 'Senior Java', description: 'Java Spring backend. We are looking for an engineer to build our services with the team. Send CV to @hiring_team.', source, url, applyUrl: url, location: '', retrievedAt: new Date().toISOString() }
    const collection = await collectVacancies({ runId: 'tg-role', sources: [source], scope }, { strategy: { name: 'fixture', discover: async () => ({ positions: [position], audit: [{ source, status: 'partial', pages: [source.url], found: 1, issues: ['One page missing'] }] }) } })
    await saveCollection(collection, write)
    const classified = await classifyVacancies({ collection, selectionRules }, { assessGlobal, assess: async () => ({ decision: 'eligible', reasons: ['Java backend'], evidence: ['Java Spring backend'] }) })
    await saveClassification(classified, write)
    const saved = await loadCollection('tg-role', read)
    assert.equal(saved.classification!.collection.positions[0].applicationDestinations![0].address, 'https://t.me/hiring_team')
    const row: any = (await f.db.query('SELECT sources FROM noco.vacancies')).rows[0]
    assert.equal(row.sources[0].applicationDestinations[0].channel, 'telegram')
    assert.equal(row.sources[0].market.value, 'global')
    assert.equal((await f.db.query("SELECT count(*)::int n FROM noco.applications WHERE channel='external-responses'")).rows[0].n, 0)
  } finally { await f.db.close() }
})

test('DB pipeline persists stages independently, preserves hashes and all-stack decisions, resumes intent and reports confirmations', async () => {
  const f = await runtimeFixture()
  try {
    const db = { pool: f.pool, database: f.database, read: createReadSession(f.pool, f.database), write: <T>(fn: any) => writeTransaction(f.pool, f.database, fn) as Promise<T>, close: async () => {} }
    const catalog = await loadDatabaseSources(fn => db.read(s => fn(s, {} as any, {} as any)))
    assert.equal(catalog.sources.length, 1)
    const scope = buildCampaignScope({ database: f.database, stacks: [{ id: '5', name: 'Java', description: 'Middle/senior Spring backend' }], students: [{ studentId: '1', stackId: '5' }] })
    const position: Position = { id: 'will-be-normalized', company: 'Current', title: 'Senior Java Engineer', description: 'Build and maintain Spring backend services with Java. Responsibilities include production APIs, databases and distributed systems. Requirements: experience delivering reliable software, collaboration with the engineering team and automated testing.', location: 'Remote', url: 'https://example.test/jobs/123', applyUrl: 'https://example.test/jobs/123/apply', retrievedAt: new Date().toISOString(), source: catalog.sources[0] }
    const collection = await collectVacancies({ runId: 'test-run', sources: catalog.sources, scope }, { strategy: { name: 'fixture', discover: async () => ({ positions: [position, { ...position, url: position.url + '-pending', applyUrl: position.url + '-pending/apply' }], audit: [{ source: catalog.sources[0], status: 'complete', pages: [catalog.sources[0].url], found: 2, issues: [] }] }) } })
    await saveCollection(collection, db.write)
    await saveCollection(collection, db.write)
    const pendingId = collection.positions.find(p => p.url.endsWith('-pending'))!.id
    const classified = await classifyVacancies({ collection, selectionRules, evaluation: { pendingIds: [pendingId], hits: 0, calls: 0, records: {} } }, { assessGlobal, assess: async p => ({ decision: p.id === pendingId ? 'review' : 'eligible', reasons: ['Matches or pending review'], evidence: ['Spring backend'] }) })
    await saveClassification(classified, db.write)
    const loaded = await loadCollection('test-run', db.read)
    assert.deepEqual(loaded.collection, collection)
    assert.throws(() => assertCollectionReady(loaded.classification!), /collection_changed/)
    assertCollectionReady(loaded.classification!, [collection.positions[0].id])
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.vacancy_stacks')).rows[0].n, 1)
    await assert.rejects(saveCollection({ ...collection, createdAt: '2025-01-01' }, db.write))
    const candidate: Candidate = { id: 'student', databaseClientId: '1', cv: { path: 'unchanged.pdf', sha256: 'original', fileName: 'cv.pdf' }, facts: {}, criteria: { titles: [] }, history: [], createdAt: new Date().toISOString() }
    const local: Store = { candidate: async () => structuredClone(candidate), saveCandidate: async () => {}, batch: async () => undefined, batches: async () => [], saveBatch: async () => { throw Error('disk export failed') }, lock: async () => async () => {}, event: async () => {} }
    const store = createPostgresStore(local, db), release = await store.lock('student')
    await assert.rejects(store.lock('student'), /locked/)
    const batch: BatchState = { id: 'batch', candidateId: 'student', targetIds: [collection.positions[0].id], limit: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), collection: { runId: 'test-run', digest: classified.digest, stackId: scope.stacks[0].id, studentId: '1' }, records: [{ position: collection.positions[0], status: 'submitting', detail: 'Durable intent', attempt: 1, updatedAt: new Date().toISOString() }] }
    await store.saveBatch(batch)
    assert.equal((await store.batch('student', 'batch'))!.records[0].status, 'submitting')
    assert.equal((await f.db.query("SELECT submission_status FROM noco.applications WHERE channel='external-responses'")).rows[0].submission_status, 'submitting')
    await assert.rejects(store.saveBatch({ ...batch, limit: 2 }))
    const other = { ...batch, id: 'replacement' }
    await assert.rejects(store.saveBatch(other))
    assert.equal((await store.candidate('student')).cv.sha256, 'original')
    f.failOn='INSERT INTO noco.application_batches'
    batch.records[0].status='unknown'
    await assert.rejects(store.saveBatch(batch)); f.failOn=''
    assert.equal((await f.db.query("SELECT submission_status FROM noco.applications WHERE channel='external-responses'")).rows[0].submission_status,'submitting')
    f.failCommit=true
    await assert.rejects(store.saveBatch(batch),/commit_uncertain/); f.failCommit=false
    assert.equal((await store.batch('student','batch'))!.records[0].status,'unknown')
    batch.records[0].status = 'succeeded'
    batch.records[0].manualAssistance = true
    batch.records[0].evidence = { url: 'https://example.test/thanks', message: 'Screenshot only', observedAt: new Date().toISOString() }
    await assert.rejects(store.saveBatch(batch), /confirmation_evidence_required/)
    batch.records[0].evidence = { url: 'https://example.test/thanks', message: 'Application received; cookie=secret', observedAt: new Date().toISOString(), confirmation: 'captured' }
    await store.saveBatch(batch)
    const downgraded=structuredClone(batch);downgraded.records[0].status='unknown'
    await assert.rejects(store.saveBatch(downgraded),/captured_confirmation_cannot_be_downgraded/)
    await release()
    const sql = (await f.db.query("SELECT confirmation_kind,evidence,source FROM noco.applications WHERE channel='external-responses'")).rows[0]
    assert.equal(sql.confirmation_kind, 'captured'); assert.equal((sql.source as any).manualAssistance, true)
    assert.ok(!JSON.stringify(sql.evidence).includes('secret'))
    const report = await generateReport({ candidateId: 'student', batchId: 'batch' }, { store })
    assert.match(report.markdown, /Current/)
    assert.equal(report.results.length, 1)
    assert.equal((await f.db.query("SELECT count(*)::int AS n FROM noco.applications WHERE channel='legacy'")).rows[0].n, 1)
  } finally { await f.db.close() }
})

test('missing/blocked/deferred company sources stay visible and cannot become employers', async () => {
  const f = await runtimeFixture()
  try {
    await f.db.exec("INSERT INTO noco.companies(name,directory_status,import_key) VALUES('Only LinkedIn','active','only-li'); INSERT INTO noco.sources(import_key,name,type,url,disposition,provenance) VALUES('general-board','Jobs','aggregator','https://board.test','enabled','{}')")
    const catalog = await loadDatabaseSources(fn => fn({ query: async (sql, params) => f.db.query(sql, params), release() {} }, {} as any, {} as any))
    assert.equal(catalog.companyIds.length, 2); assert.equal(catalog.issues.length, 1)
    assert.equal(catalog.deferred[0].reason, 'adapter_required:aggregator')
  } finally { await f.db.close() }
})
