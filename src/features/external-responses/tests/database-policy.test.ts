import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { createWorkingCatalog, quoted } from '../../../integrations/postgres/working-catalog.mts'
import { workingReads } from '../../../integrations/postgres/working-reads.mts'
import { TABLES } from '../infrastructure/database.ts'
import type { DatabaseRead } from '../infrastructure/database.ts'
import { loadCampaignScope } from '../stack_catalog/postgres.ts'
import { createPostgresRestrictionPolicy } from '../candidate_matching/postgres.ts'
import type { Candidate } from '../types.ts'

async function fixture() {
  const db = new PGlite(), definitions: any[] = []
  await db.exec('CREATE SCHEMA noco;')
  const ids = { stacks: TABLES.stacks.id, clients: TABLES.clients.id, restrictions: TABLES.restrictions.id, companies: TABLES.companies.id, junction: 'mtestjunction' }
  const layouts = {
    stacks: { name: 'text', stack_description: 'text' },
    clients: { stack_id: 'bigint', stop_list_company: 'text' },
    restrictions: { client_id: 'bigint', market: 'text', from_legend_resume_companies: 'text', currently_interviewing_companies: 'text', offer_companies: 'text' },
    companies: { company_name: 'text' }, junction: { restriction_id: 'bigint', company_id: 'bigint' }
  }
  for (const [key, fields] of Object.entries(layouts)) {
    const id = ids[key as keyof typeof ids]
    const physicalName = key === 'companies' ? 'legacy_companies' : key
    const columns = Object.entries({ Id: 'bigint', ...fields }).map(([title, sqlType]) => ({ id: `${id}_${title}`, title, pk: title === 'Id', sqlName: title === 'Id' ? 'id' : title, sqlType }))
    definitions.push({ id, title: key, table_name: key, sqlName: physicalName, sqlTable: `noco.${physicalName}`, columns, mapping: columns.map(c => ({ id: c.id, title: c.title, sqlName: c.sqlName, sqlType: c.sqlType })) })
    await db.exec(`CREATE TABLE noco.${quoted(physicalName)} (${columns.map(c => `${quoted(c.sqlName)} ${c.sqlType}${c.pk ? ' PRIMARY KEY' : ''}`).join(',')},_copy_id text UNIQUE NOT NULL)`)
  }
  function link(key: string, title: string, options: Record<string, unknown>) {
    const d = definitions.find(d => d.table_name === key), id = d.id + '_' + title
    d.columns.push({ id, title, uidt: 'Links', colOptions: options })
    d.mapping.push({ id, title, sqlName: 'virtual_' + d.columns.length, sqlType: 'jsonb' })
  }
  link('clients', 'rel_clients_primary_stack', { type: 'bt', fk_related_model_id: ids.stacks, fk_child_column_id: ids.clients + '_stack_id', fk_parent_column_id: ids.stacks + '_Id' })
  link('restrictions', 'rel_restrictions_client', { type: 'bt', fk_related_model_id: ids.clients, fk_child_column_id: ids.restrictions + '_client_id', fk_parent_column_id: ids.clients + '_Id' })
  link('restrictions', 'rel_restrictions_blocked_companies', { type: 'mm', fk_related_model_id: ids.companies, fk_child_column_id: ids.restrictions + '_Id', fk_parent_column_id: ids.companies + '_Id', fk_mm_model_id: ids.junction, fk_mm_child_column_id: ids.junction + '_restriction_id', fk_mm_parent_column_id: ids.junction + '_company_id' })
  await db.exec(`INSERT INTO noco.stacks VALUES(5,'Java','Java Spring backend', '["5"]'),(22,'Vue',NULL,'["22"]');
    INSERT INTO noco.clients VALUES(20,5,'Only positions in Paris','["20"]');
    INSERT INTO noco.restrictions VALUES(1,20,'En',NULL,'Interviewing Corp',NULL,'["1"]'),(2,20,'Ru',NULL,NULL,NULL,'["2"]');
    INSERT INTO noco.legacy_companies VALUES(7,'Blocked Corp','["7"]');
    INSERT INTO noco.junction VALUES(1,1,7,'["1"]');
    CREATE TABLE noco.companies(id bigint,name text,website text,application_route text DEFAULT 'standard_workflow');
    INSERT INTO noco.companies(id,name,website) VALUES(1,'Global Corp','https://global.test');
    CREATE TABLE noco.active_restrictions(id bigint,reason text,action text,include_subsidiaries boolean,company_id bigint,is_global boolean,client_id bigint,market text,channels text[],scope text DEFAULT 'company',instruction text DEFAULT '',context jsonb DEFAULT '{}',hh_names text[] DEFAULT '{}');
    INSERT INTO noco.active_restrictions(id,reason,action,include_subsidiaries,company_id,is_global,client_id,market,channels)
      VALUES(1,'Current global policy','block_application',false,1,true,NULL,'all',ARRAY['all']),(2,'HH only','block_application',false,1,true,NULL,'all',ARRAY['hh']);
    INSERT INTO noco.active_restrictions(id,client_id,is_global,market,channels,scope,instruction,context)
      VALUES(3,20,false,'all',ARRAY['external-responses'],'contextual','Use stored policy','{"storedRestriction":"Only positions in Paris"}'),
      (4,20,false,'en',ARRAY['external-responses'],'contextual','Use stored policy','{"blockedCompanies":[{"id":"7","name":"Blocked Corp"}]}');`)
  const catalog = createWorkingCatalog(definitions.map(definition => ({ definition })))
  const session = { query: async (text: string, values?: unknown[]) => ({ rows: (await db.query(text, values)).rows as Record<string, unknown>[] }), release() {} }
  const read: DatabaseRead = operation => operation(session, catalog, workingReads(session, catalog))
  return { db, read }
}

test('database scope resolves native metadata and preserves only populated existing stacks', async () => {
  const { db, read } = await fixture()
  try {
    const result = await loadCampaignScope({}, { read })
    assert.equal(result.stacks.length, 1)
    assert.equal(result.stacks[0].databaseId, '5'); assert.deepEqual(result.stacks[0].studentIds, ['20'])
    assert.equal(result.stacks[0].description, 'Java Spring backend')
    assert.equal(result.excluded[0].databaseId, '22')
  } finally { await db.close() }
})

test('database restrictions use canonical company/contextual rules only, scoped by market/channel', async () => {
  const { db, read } = await fixture()
  const candidate = { id: 'local', databaseClientId: '20' } as Candidate
  const policy = createPostgresRestrictionPolicy({ read, market: 'en', expectedStack: { databaseId: '5', description: 'Java Spring backend' } })
  try {
    const set = await policy.load(candidate)
    assert.equal(set.complete, true); assert.equal(set.studentId, '20')
    assert.deepEqual(set.rules.map(r => r.id), ['company_management:1', 'company_management:3', 'company_management:4'])
    assert.equal(set.rules[2].source, 'noco.active_restrictions')
    assert.equal((set.rules[1].context?.context as any).storedRestriction, 'Only positions in Paris')
    assert.deepEqual((set.rules[2].context?.context as any).blockedCompanies, [{ id: '7', name: 'Blocked Corp' }])
    await db.exec('DROP TABLE noco.restrictions; DROP TABLE noco.junction; DROP TABLE noco.legacy_companies;')
    assert.equal((await policy.load(candidate)).rules.length,3)
    await db.exec("UPDATE noco.stacks SET stack_description='Changed policy' WHERE id=5")
    await assert.rejects(policy.load(candidate), /stack_description_changed/)
    await db.exec('UPDATE noco.clients SET stack_id=22 WHERE id=20')
    await assert.rejects(policy.load(candidate), /student_stack_changed/)
  } finally { await db.close() }
})
