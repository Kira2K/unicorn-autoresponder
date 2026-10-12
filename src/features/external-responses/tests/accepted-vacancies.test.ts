import test from 'node:test'
import assert from 'node:assert/strict'
import { workflowFixture as runtimeFixture } from '../../company-client-management/tests/runtime-fixture.mts'
import { createReadSession } from '../../../integrations/postgres/read-session.mts'
import { writeTransaction } from '../../../integrations/postgres/working-session.mts'
import { loadDatabaseSources } from '../company_sources/postgres.ts'
import { buildCampaignScope } from '../stack_catalog/campaign.ts'
import { collectVacancies } from '../vacancy_collection/index.ts'
import { saveCollection, loadCollection } from '../vacancy_collection/postgres.ts'
import { classifyVacancies } from '../stack_classification/index.ts'
import { saveClassification } from '../stack_classification/postgres.ts'
import { matchCandidatePositions } from '../candidate_matching/index.ts'
import { generateCollectionReport } from '../reporting/collection.ts'
import type { SqlOperation } from '../infrastructure/postgres.ts'
import type { Position } from '../types.ts'
import { selectionRules, assessGlobal } from './selection-fixture.ts'

async function setup() {
  const f = await runtimeFixture(), read = createReadSession(f.pool, f.database)
  const write: SqlOperation = fn => writeTransaction(f.pool, f.database, fn)
  await f.db.exec('INSERT INTO noco.stacks VALUES(2),(3)')
  const sources = (await loadDatabaseSources(fn => read(s => fn(s, {} as any, {} as any)))).sources
  const scope = buildCampaignScope({ database: f.database,
    stacks: [{ id: '5', name: 'Java', description: 'Middle/senior Spring backend' }, { id: '2', name: 'Python', description: 'Middle/senior FastAPI backend' }, { id: '3', name: 'FullStack', description: 'Senior JS/TS, <=60% backend' }],
    students: [{ studentId: '1', stackId: '5' }, { studentId: '2', stackId: '2' }, { studentId: '3', stackId: '3' }],
  })
  const roles = ['Java backend', 'L1 support', 'PHP developer', 'Uncertain stack', 'Missing description', 'JS product engineer']
  const positions: Position[] = roles.map((title, i) => ({ id: String(i), company: sources[0].name, title, description: i === 4 ? '' : `Responsibilities: ${title}. Own reliable production delivery, collaborate with the product team and maintain the systems in your area.`, location: 'Remote', url: sources[0].url + '/' + i, applyUrl: sources[0].url + '/' + i, source: sources[0], retrievedAt: '2026-09-27T12:00:00Z' }))
  const collect = (runId: string, rows = positions) => collectVacancies({ runId, sources, scope }, { strategy: { name: 'fixture', discover: async () => ({ positions: rows, audit: [{ source: sources[0], status: 'complete', pages: [sources[0].url], found: rows.length, issues: [] }] }) } })
  return Object.assign(f, { read, write, scope, sources, positions, collect })
}

test('raw collection creates no vacancy rows; only matches enter SQL, with matched stack links and full audit retained', async () => {
  const f = await setup()
  try {
    const collection = await f.collect('accepted-only')
    await saveCollection(collection, f.write)
    await saveCollection(collection, f.write)
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.vacancies')).rows[0].n, 0)
    const classified = await classifyVacancies({ collection, selectionRules }, { assessGlobal, assess: async (position, stack) => ({
      decision: position.title === 'Java backend' && stack.databaseId === '5' || position.title === 'JS product engineer' && ['2', '3'].includes(stack.databaseId!)
        ? 'eligible' : position.title === 'Uncertain stack' ? 'review' : 'excluded',
      reasons: ['Injected fixture decision; not a model accuracy test'], evidence: [position.description],
    }) })
    f.failCommit = true
    await assert.rejects(saveClassification(classified, f.write), /commit_uncertain/)
    f.failCommit = false
    await saveClassification(classified, f.write)
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.vacancies WHERE jsonb_array_length(sources)<>1')).rows[0].n, 0,
      'Initial insertion stores each identical provenance entry once')
    assert.deepEqual((await f.db.query('SELECT title,description FROM noco.vacancies ORDER BY title')).rows,
      [f.positions[5],f.positions[0]].map(({title,description})=>({title,description})))
    const links = (await f.db.query('SELECT stack_id::text,decision FROM noco.vacancy_stacks ORDER BY stack_id')).rows
    assert.deepEqual(links, [{ stack_id: '2', decision: 'matched' }, { stack_id: '3', decision: 'matched' }, { stack_id: '5', decision: 'matched' }])
    const shared = (await f.db.query(`SELECT v.id::text, array_agg(vs.stack_id::text ORDER BY vs.stack_id) AS stacks
      FROM noco.vacancies v JOIN noco.vacancy_stacks vs ON vs.vacancy_id=v.id
      WHERE v.title='JS product engineer' GROUP BY v.id`)).rows
    assert.equal(shared.length, 1, 'Two stack matches must share one canonical vacancy')
    assert.deepEqual(shared[0].stacks, ['2', '3'])
    const loaded = await loadCollection('accepted-only', f.read)
    assert.equal(loaded.classification!.collection.positions.length, 6, 'Rejected and review observations remain audit evidence')
    assert.ok(loaded.classification!.groups['stack-5'].excludedIds.length)
    assert.match(generateCollectionReport(loaded.classification!).markdown, /Unique discoveries: 6\. Accepted vacancies: 2/)
    const matches = []
    for (const stackId of ['2', '3']) {
      const candidate = { id: 'student-' + stackId, databaseClientId: stackId, facts: {}, history: [] }
      matches.push(await matchCandidatePositions({ candidate, collection: loaded.classification!, stackId: 'stack-' + stackId }, {
        restrictions: { load: async student => ({ studentId: student.databaseClientId!, complete: true, checkedAt: new Date().toISOString(), rules: [] }) }
      }))
    }
    assert.deepEqual(matches.map(m => m.positions.map(p => [p.id, p.fit?.decision])),
      [[ [loaded.classification!.groups['stack-2'].matchedIds[0], 'eligible'] ], [ [loaded.classification!.groups['stack-2'].matchedIds[0], 'eligible'] ]],
      'Students in either matched stack reuse the same saved vacancy without a CV')
    assert.equal((await f.db.query("SELECT count(*)::int AS n FROM noco.applications WHERE channel='external-responses'")).rows[0].n, 0,
      'Collection, classification and matching must not create applications')

    // A later rejected observation cannot overwrite an accepted body's data/history.
    const rejected = await f.collect('all-rejected', f.positions.map(p => ({ ...p, description: 'Rejected updated body', retrievedAt: '2026-09-28T12:00:00Z' })))
    await saveCollection(rejected, f.write)
    await saveClassification(await classifyVacancies({ collection: rejected, selectionRules }, { assessGlobal, assess: async () => ({ decision: 'excluded', reasons: ['Outside scope'], evidence: ['Rejected updated body'] }) }), f.write)
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.vacancies')).rows[0].n, 2)
    assert.equal((await f.db.query("SELECT count(*)::int AS n FROM noco.vacancies WHERE description='Rejected updated body'")).rows[0].n, 0)
    assert.equal((await f.db.query("SELECT count(*)::int AS n FROM noco.vacancy_stacks WHERE run_id='all-rejected'")).rows[0].n, 0)
  } finally { await f.db.close() }
})

test('accepted SQL rows retain explicit ATS identity and unique initial provenance', async () => {
  const f = await setup()
  try {
    const position = { ...f.positions[0], url: 'https://boards.greenhouse.io/acme/jobs/123', applyUrl: 'https://boards.greenhouse.io/acme/jobs/123', sources: [f.sources[0], f.sources[0]] }
    const collection = await f.collect('ats-identity', [position])
    await saveCollection(collection, f.write)
    await saveClassification(await classifyVacancies({ collection, selectionRules }, { assessGlobal, assess: async () => ({ decision: 'eligible', reasons: ['Fixture match'], evidence: [position.description] }) }), f.write)
    assert.deepEqual((await f.db.query('SELECT platform,external_namespace,external_id,jsonb_array_length(sources) AS origins FROM noco.vacancies')).rows,
      [{ platform: 'greenhouse', external_namespace: 'greenhouse', external_id: '123', origins: 1 }])
  } finally { await f.db.close() }
})

test('accepted rows, matched links and classification commit atomically; tampered classifications never write', async () => {
  const f = await setup()
  try {
    const collection = await f.collect('rollback', [f.positions[0]])
    await saveCollection(collection, f.write)
    const classified = await classifyVacancies({ collection, selectionRules }, { assessGlobal, assess: async () => ({ decision: 'eligible', reasons: ['Matches fixture'], evidence: [collection.positions[0].description] }) })
    const tampered = structuredClone(classified); tampered.decisions['stack-5'][collection.positions[0].id].decision = 'excluded'
    await assert.rejects(saveClassification(tampered, f.write), /collection_changed|classification/)
    f.failOn = 'INSERT INTO noco.vacancy_stacks'
    await assert.rejects(saveClassification(classified, f.write))
    f.failOn = ''
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.vacancies')).rows[0].n, 0)
    assert.equal((await loadCollection('rollback', f.read)).classification, null)
    await saveClassification(classified, f.write)
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.vacancies')).rows[0].n, 1)
  } finally { await f.db.close() }
})

test('SQL promotion requires global rule evidence and never saves a globally rejected stack match', async () => {
  const f = await setup()
  try {
    const collection = await f.collect('shared-rule-gate', [f.positions[0], { ...f.positions[1], title: 'Under salary floor', description: 'USD 2,000 gross monthly. Responsibilities: build Java Spring backend services and maintain production APIs with the development team.' }])
    await saveCollection(collection, f.write)
    const assess = async (position: Position) => ({ decision: 'eligible' as const, reasons: ['Fixture stack match'], evidence: [position.description] })
    await assert.rejects(saveClassification(await classifyVacancies({ collection }, { assess }), f.write), /vacancy_selection_rules_required/)
    const classified = await classifyVacancies({ collection, selectionRules }, {
      assess,
      assessGlobal: async position => ({ decision: position.title === 'Under salary floor' ? 'excluded' : 'eligible', reasons: ['Injected global salary decision'], evidence: [position.description] })
    })
    await saveClassification(classified, f.write)
    assert.deepEqual((await f.db.query('SELECT title FROM noco.vacancies')).rows, [{ title: 'Java backend' }])
    const loaded = await loadCollection('shared-rule-gate', f.read)
    assert.equal(loaded.classification!.selectionRules!.sha256, selectionRules.sha256)
    assert.equal(Object.values(loaded.classification!.globalDecisions!).filter(d => d.decision === 'excluded').length, 1)
  } finally { await f.db.close() }
})
