const { TABLES } = require('../../../integrations/noco/core/schema.ts') as {
  TABLES: { clients: { id: string; title: string } }
}
const { linkRecords } = require('../../../integrations/noco/core/relations.ts') as {
  linkRecords(client: any, table: any, fieldId: string, sourceRecordId: number,
    relatedIds: number[]): Promise<{ ok: boolean }>
}
const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}

function listPrimaryStacks(rows: any[]) {
  return rows.map(row => ({ id: Number(row.Id), name: String(
    row.name ?? row.stack ?? row.stack_name ?? '').trim() })).filter(row => row.id && row.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function updatePrimaryStack(client: any, rows: any, clientId: number, stackId: number) {
  const clientRow = rows.clients.find((row: any) => Number(row.Id) === clientId)
  const stack = rows.stacks.find((row: any) => Number(row.Id) === stackId)
  if (!clientRow || !stack) throw new LinkedInAuthError('noco_stack_not_found',
    'Client or primary stack was not found.')
  const meta = await client.fetchTableMeta(TABLES.clients.id)
  const relation = (meta.columns ?? []).find((column: any) =>
    column.title === 'rel_clients_primary_stack')
  if (!relation?.id) throw new LinkedInAuthError('noco_stack_relation_missing',
    'The clients primary stack relation is missing.')
  const linked = await linkRecords(client, TABLES.clients, relation.id, clientId, [stackId])
  if (!linked.ok) throw new LinkedInAuthError('noco_stack_update_failed',
    'Could not update the client primary stack.')
  return { id: stackId, name: String(stack.name ?? stack.stack ?? stack.stack_name ?? '').trim() }
}

module.exports = { listPrimaryStacks, updatePrimaryStack }
