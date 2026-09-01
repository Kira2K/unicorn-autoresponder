import { CONNECTION_TABLES, findConnectionTable } from
  '../../../integrations/noco/linkedin-connection-inviter-schema/logic.ts'
import { missingUniqueColumns } from
  '../../../integrations/noco/linkedin-connection-inviter-schema/constraints.ts'

export function createConnectionTableResolver(client: any, onRead: () => void = () => undefined) {
  let cache: Record<string, string> | undefined
  return async () => {
    if (cache) return cache
    const endpoint = `/api/v2/meta/bases/${client.config.baseId}/tables`
    onRead(); const tables = await client.request('get', endpoint)
    const resolved: Record<string, string> = {}
    for (const [key, definition] of Object.entries(CONNECTION_TABLES)) {
      const table = findConnectionTable(tables, definition.title)
      if (!table?.id) throw Object.assign(new Error(`${definition.title} is missing.`),
        { code: 'connection_inviter_tables_missing' })
      onRead(); const missing = missingUniqueColumns(await client.fetchTableMeta(table.id), definition.columns)
      if (missing.length) throw Object.assign(
        new Error(`${definition.title} lacks unique constraints: ${missing.join(', ')}`),
        { code: 'connection_inviter_unique_constraints_missing' })
      resolved[key] = String(table.id)
    }
    return cache = resolved
  }
}
