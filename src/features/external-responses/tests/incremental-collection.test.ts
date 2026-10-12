import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workflowFixture as runtimeFixture } from '../../company-client-management/tests/runtime-fixture.mts'
import { writeTransaction } from '../../../integrations/postgres/working-session.mts'
import { createReadSession } from '../../../integrations/postgres/read-session.mts'
import { loadDatabaseSources } from '../company_sources/postgres.ts'
import { buildCampaignScope } from '../stack_catalog/campaign.ts'
import { collectVacancies } from '../vacancy_collection/index.ts'
import { createWebsiteStrategy } from '../vacancy_collection/discover.ts'
import { saveCollection, loadCollection } from '../vacancy_collection/postgres.ts'
import { openCollectionCheckpoint } from '../vacancy_collection/checkpoint.ts'
import { CollectionPersistenceError } from '../vacancy_collection/persistence-error.ts'
import { classifyVacancies } from '../stack_classification/index.ts'
import { selectionRules, assessGlobal } from './selection-fixture.ts'
import { saveClassification } from '../stack_classification/postgres.ts'
import { generateCollectionReport } from '../reporting/collection.ts'
import type { SqlOperation } from '../infrastructure/postgres.ts'
import type { Position, Source, PageDocument } from '../types.ts'

const job = (source: Source, id = '1'): Position => ({
  id: 'normalize-me', company: source.name, title: 'Senior Engineer', location: 'Remote',
  description: 'Responsibilities: design and build reliable production backend services. Requirements: professional engineering experience, API ownership, testing and operational support.', url: source.url + '/' + id,
  applyUrl: source.url + '/' + id + '/apply', retrievedAt: '2026-09-27T12:00:00Z', source,
})
async function fixture() {
  const f = await runtimeFixture()
  const write: SqlOperation = fn => writeTransaction(f.pool, f.database, fn)
  const read = createReadSession(f.pool, f.database)
  const sources = (await loadDatabaseSources(fn => read(s => fn(s, {} as any, {} as any)))).sources
  const scope = buildCampaignScope({ database: f.database, stacks: [{ id: '5', name: 'Java', description: 'Middle/senior Spring backend' }], students: [{ studentId: '1', stackId: '5' }] })
  let run = 0
  const saveMatched = async (rows: Position[]) => {
    const manifest = [...new Map(rows.map(p => [JSON.stringify(p.source), p.source])).values()]
    const collection = await collectVacancies({ runId: `matched-${++run}`, sources: manifest, scope }, { strategy: { name: 'fixture', discover: async () => ({ positions: rows, audit: manifest.map(source => ({ source, status: 'complete', pages: [source.url], found: rows.length, issues: [] })) }) } })
    await saveCollection(collection, write)
    await saveClassification(await classifyVacancies({ collection, selectionRules }, { assessGlobal, assess: async position => ({ decision: 'eligible', reasons: ['Fixture match'], evidence: [position.description] }) }), write)
  }
  return Object.assign(f, { write, read, sources, scope, saveMatched })
}

test('interrupted collection resumes audit pages; canonical vacancies are created only after stack classification', async () => {
  const f = await fixture(), directory = await mkdtemp(join(tmpdir(), 'external-collection-'))
  try {
    await f.db.exec('INSERT INTO noco.stacks VALUES(2),(3)')
    const scope = buildCampaignScope({ database: f.database,
      stacks: [{ id: '5', name: 'Java', description: 'Spring backend' }, { id: '2', name: 'Python', description: 'FastAPI backend' }, { id: '3', name: 'FullStack', description: 'Senior JS/TS; at most 60% backend' }],
      students: [{ studentId: '1', stackId: '5' }, { studentId: '2', stackId: '2' }, { studentId: '3', stackId: '3' }],
    })
    const source = f.sources[0], first = job(source), second = job(source, '2'), secondPage = source.url + '?page=2'
    const identity = { runId: 'incremental', sources: f.sources, scope }
    const checkpoint = await openCollectionCheckpoint({ directory, identity })
    let firstReads = 0
    const reader = checkpoint.reader({ read: async url => {
      if (url === source.url) { firstReads++; return { url, text: '', links: [{ text: 'Next page', url: secondPage }], jobs: [first] } }
      assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.vacancies')).rows[0].n, 0)
      throw new CollectionPersistenceError('simulated_process_stop')
    } })
    await assert.rejects(collectVacancies(identity, { strategy: createWebsiteStrategy({ reader, concurrency: 1 }) }), /simulated_process_stop/)
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.collection_runs')).rows[0].n, 0)
    await checkpoint.close()

    const resumed = await openCollectionCheckpoint({ directory, identity, resume: true })
    const collection = await collectVacancies(identity, { strategy: createWebsiteStrategy({ concurrency: 1, reader: resumed.reader({ read: async url => {
      assert.equal(url, secondPage, 'the completed first page must not be fetched again')
      return { url, text: '', links: [], jobs: [second] }
    } }) }) })
    assert.equal(firstReads, 1)
    await resumed.complete(collection)
    f.failCommit = true
    await assert.rejects(saveCollection(collection, f.write), /commit_uncertain/)
    f.failCommit = false
    await resumed.close()
    const completeReplay = await openCollectionCheckpoint({ directory, identity, resume: true })
    assert.deepEqual(completeReplay.completed, collection)
    await saveCollection(completeReplay.completed!, f.write)
    await completeReplay.close()
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.vacancies')).rows[0].n, 0)

    // Exercise saved SQL bodies and all three existing stack IDs without AI calls.
    const loaded = await loadCollection('incremental', f.read)
    const classified = await classifyVacancies({ collection: loaded.collection, selectionRules }, { assessGlobal, assess: async (position, stack) => ({
      decision: stack.databaseId === '5' ? 'eligible' : stack.databaseId === '2' ? 'excluded' : 'review',
      reasons: ['Fixture policy decision'], evidence: [position.description],
    }) })
    await saveClassification(classified, f.write)
    const decisions = (await f.db.query('SELECT decision,count(*)::int AS n FROM noco.vacancy_stacks GROUP BY decision ORDER BY decision')).rows
    assert.deepEqual(decisions, [{ decision: 'matched', n: 2 }])
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.vacancies')).rows[0].n, 2)
    assert.match(generateCollectionReport(classified).markdown, /Unique discoveries: 2\. Accepted vacancies: 2/)
    assert.equal((await loadCollection('incremental', f.read)).classification!.groups['stack-2'].excludedIds.length, 2)
    assert.equal((await loadCollection('incremental', f.read)).classification!.groups['stack-3'].reviewIds.length, 2)
  } finally { await f.db.close(); await rm(directory, { recursive: true, force: true }) }
})

test('accepted upserts retain descriptions and provenance; failed promotions roll back', async () => {
  const f = await fixture()
  try {
    const first = job(f.sources[0])
    await f.saveMatched([first, { ...first, url: first.url + '?utm_source=repeat' }, job(f.sources[0], 'another-job-same-title')])
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.vacancies')).rows[0].n, 2)
    const extra = { ...f.sources[0], provenance: 'second observation' }
    await f.saveMatched([{ ...first, source: extra, retrievedAt: '2026-09-28T12:00:00Z' }])
    await f.saveMatched([{ ...first, description: '', retrievedAt: '2026-09-29T12:00:00Z' }])
    await f.saveMatched([{ ...first, description: 'Old body', retrievedAt: '2026-09-20T12:00:00Z' }])
    const row = (await f.db.query('SELECT description,sources FROM noco.vacancies WHERE canonical_url=$1', [first.url])).rows[0]
    assert.equal(row.description, first.description)
    assert.equal((row.sources as any[]).length, 2)
    f.failOn = 'INSERT INTO noco.vacancies'
    await assert.rejects(f.saveMatched([job(f.sources[0], 'not-committed')]))
    f.failOn = ''
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.vacancies')).rows[0].n, 2)
    const invalid = { ...job(f.sources[0], 'invalid'), source: { ...f.sources[0], database: { ...f.sources[0].database!, sourceId: '999999' } } }
    await assert.rejects(f.saveMatched([job(f.sources[0], 'atomic-good'), invalid]), /vacancy_source_binding_changed/)
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.vacancies')).rows[0].n, 2)
  } finally { await f.db.close() }
})

test('persistence failure aborts collection rather than becoming a successful or partial source result', async () => {
  const source = { name: 'Fixture', url: 'https://fixture.test/jobs' }
  const strategy = createWebsiteStrategy({ reader: { read: async () => ({ url: source.url, text: '', links: [], jobs: [job(source)] }) } })
  let writes = 0
  await assert.rejects(collectVacancies({ runId: 'fail', sources: [source] }, { strategy, checkpointPositions: async () => { writes++; throw Error('storage unavailable') } }), /storage unavailable/)
  assert.equal(writes, 1)
})

test('found positions with missing descriptions stay in audit review without an AI request', async () => {
  const source = { name: 'Fixture', url: 'https://fixture.test/jobs' }, saved: Position[] = []
  const collection = await collectVacancies({ runId: 'missing-body', sources: [source] }, {
    strategy: createWebsiteStrategy({ reader: { read: async () => ({ url: source.url, text: '', links: [], jobs: [{ ...job(source), description: '' }] }) } }),
    checkpointPositions: async rows => { saved.push(...rows) },
  })
  const classified = await classifyVacancies({ collection, stacks: [{ id: 'stack-5', name: 'Java', description: 'Middle/senior Spring' }] }, {
    assess: async () => { assert.fail('Missing text must not spend an AI call or become eligible') },
  })
  assert.equal(saved.length, 1)
  assert.deepEqual(classified.groups['stack-5'].reviewIds, [collection.positions[0].id])
})

test('legacy strategies checkpoint final discoveries, and source validation precedes the audit callback', async () => {
  const source = { name: 'Fixture', url: 'https://fixture.test/jobs' }, saved: Position[][] = []
  const strategy = { name: 'legacy', discover: async () => ({ positions: [job(source)], audit: [] }) }
  await collectVacancies({ runId: 'legacy', sources: [source] }, { strategy, checkpointPositions: async rows => { saved.push(rows) } })
  assert.equal(saved.flat().length, 1)
  await assert.rejects(collectVacancies({ runId: 'invalid', sources: [source] }, {
    strategy: { ...strategy, discover: async () => ({ positions: [{ ...job(source), sources: [{ name: 'Outside', url: 'https://outside.test' }] }], audit: [] }) },
    checkpointPositions: async () => { assert.fail('unbound provenance must not reach storage') },
  }), /vacancy_source_outside_manifest/)
})

test('checkpoints reject changed scope and concurrent use, preserve acquisition times, and do not cache failed reads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'external-checkpoint-'))
  const identity = { runId: 'checkpoint', sources: [{ name: 'Fixture', url: 'https://fixture.test' }] }
  try {
    const cp = await openCollectionCheckpoint({ directory, identity })
    await assert.rejects(openCollectionCheckpoint({ directory, identity, resume: true }), /checkpoint_locked/)
    const document: PageDocument = { url: 'https://fixture.test', text: '', links: [], jobs: [] }
    await assert.rejects(cp.reader({ read: async () => { throw Error('temporary') } }).read(document.url), /temporary/)
    const page = await cp.reader({ read: async () => document }).read(document.url)
    assert.ok(page.fetchedAt)
    await cp.close()
    await assert.rejects(openCollectionCheckpoint({ directory, identity: { ...identity, sources: [] }, resume: true }), /checkpoint_scope_changed/)
    const resumed = await openCollectionCheckpoint({ directory, identity, resume: true })
    assert.deepEqual(await resumed.reader({ read: async () => { assert.fail('saved page should be reused') } }).read(document.url), page)
    await resumed.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
