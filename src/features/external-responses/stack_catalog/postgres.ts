import { tableSql, quoted } from '../../../integrations/postgres/working-catalog.mts'
import { relation } from '../../../integrations/postgres/working-relations.mts'
import { TABLES } from '../infrastructure/database.ts'
import type { DatabaseRead } from '../infrastructure/database.ts'
import { buildCampaignScope } from './campaign.ts'
import type { StackRow, StudentStackRow } from './campaign.ts'

export function loadCampaignScope(input: { stackIds?: string[]; studentIds?: string[] }, deps: { read: DatabaseRead }) {
  return deps.read(async (session, catalog) => {
    const stacks = catalog.get(TABLES.stacks.id), clients = catalog.get(TABLES.clients.id)
    const link = clients.columns.find(c => c.title === 'rel_clients_primary_stack')
    if (!link) throw Error('student_stack_relation_required')
    const r = relation(catalog, clients.id, link.id)
    if (!r.forward || r.junction || r.target.id !== stacks.id) throw Error('student_stack_relation_invalid')
    const pk = stacks.columns.find(c => c.pk)!, clientPk = clients.columns.find(c => c.pk)!
    const name = stacks.columns.find(c => c.dataKey === 'name'), description = stacks.columns.find(c => c.dataKey === 'stack_description')
    if (!name || !description) throw Error('stack_description_column_required')
    const stackRows = (await session.query(`SELECT ${quoted(pk.sqlName)}::text AS id,${quoted(name.sqlName)} AS name,${quoted(description.sqlName)} AS description FROM ${tableSql(stacks)} ORDER BY ${quoted(pk.sqlName)}`)).rows as StackRow[]
    const students = (await session.query(`SELECT ${quoted(clientPk.sqlName)}::text AS "studentId",${quoted(r.child.column.sqlName)}::text AS "stackId" FROM ${tableSql(clients)} ORDER BY ${quoted(clientPk.sqlName)}`)).rows as StudentStackRow[]
    const database = String((await session.query('SELECT current_database() AS database')).rows[0].database)
    return buildCampaignScope({ ...input, database, stacks: stackRows, students })
  })
}
