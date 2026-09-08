import { tableNames } from '../../../features/linkedin-automation/post-writer/noco-store.ts'
import type { NocoTransport } from '../../../features/linkedin-automation/post-writer/noco-transport.ts'
import { object, PostError } from '../../../features/linkedin-automation/post-writer/errors.ts'
import { columns, schemaIssues } from './contract.ts'
export { columns } from './contract.ts'
const rows = (value: unknown): Record<string, unknown>[] => {
  const items = Array.isArray(value) ? value : object(value).list
  if (!Array.isArray(items)) throw new PostError('post_schema_invalid')
  return items.map(object)
}
export async function ensurePostSchema(http: NocoTransport, apply = false) {
  const path = `/api/v2/meta/bases/${http.baseId}/tables`
  let tables = rows(await http.request('GET', path))
  const result: { table: string; missing: string[] }[] = []
  for (const title of Object.values(tableNames)) {
    if (tables.filter(item => item.title === title).length > 1) throw new PostError('post_duplicate_tables')
    let table = tables.find(item => item.title === title)
    if (!table && apply) {
      await http.request('POST', path, { title, table_name: title, columns })
      tables = rows(await http.request('GET', path))
      table = tables.find(item => item.title === title)
    }
    if (!table && apply) throw new PostError('post_schema_incomplete')
    if (!table) { result.push({ table: title, missing: columns.map(item => item.title) }); continue }
    let meta = object(await http.request('GET', `/api/v2/meta/tables/${table.id}`))
    let fields = rows(meta.columns)
    const missing = columns.filter(column => !fields.some(item => item.title === column.title))
    if (apply) {
      for (const column of missing) await http.request('POST', `/api/v2/meta/tables/${table.id}/columns`, column)
      meta = object(await http.request('GET', `/api/v2/meta/tables/${table.id}`))
      fields = rows(meta.columns)
    }
    const issues = schemaIssues(fields)
    if (apply && issues.length) throw new PostError('post_schema_incomplete')
    result.push({ table: title, missing: issues })
  }
  return result
}
