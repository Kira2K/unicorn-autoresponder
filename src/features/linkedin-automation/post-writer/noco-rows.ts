import { object, PostError } from './errors.ts'
import type { NocoTransport } from './noco-transport.ts'
import type { Tables } from './types.ts'
import { schemaIssues } from '../../../integrations/noco/linkedin-post-writer-schema/contract.ts'
export const tableNames = { settings: 'linkedin_post_settings', runs: 'linkedin_post_runs',
  history: 'linkedin_post_history' } as const
type Bucket = keyof Tables
export function validKey(key: string) {
  if (!/^[a-z0-9_-]{1,180}$/i.test(key)) throw new PostError('post_key_invalid')
  return key
}
export function createNocoRows(http: NocoTransport) {
  let metadata: Promise<Record<Bucket, string>> | undefined
  const validated = new Set<string>()
  async function table(bucket: Bucket) {
    metadata ??= http.request('GET', `/api/v2/meta/bases/${http.baseId}/tables`).then(value => {
      const items = Array.isArray(value) ? value : object(value).list
      if (!Array.isArray(items)) throw new PostError('post_schema_missing')
      return Object.fromEntries(Object.entries(tableNames).map(([key, name]) => {
        const found = items.map(object).filter(row => row.title === name)
        if (found.length > 1) throw new PostError('post_duplicate_tables')
        if (!found[0]?.id) throw new PostError('post_schema_missing')
        return [key, String(found[0].id)]
      })) as Record<Bucket, string>
    }).catch(error => { metadata = undefined; throw error })
    const id = (await metadata)[bucket]
    if (!validated.has(id)) {
      const meta = object(await http.request('GET', `/api/v2/meta/tables/${id}`))
      if (!Array.isArray(meta.columns) || schemaIssues(meta.columns.map(object)).length) {
        throw new PostError('post_schema_incomplete')
      }
      validated.add(id)
    }
    return id
  }
  function decode<K extends Bucket>(bucket: K, row: Record<string, unknown>) {
    const key = validKey(String(row.record_key ?? ''))
    const value = object(JSON.parse(String(row.state_json)))
    const id = Number(row.Id)
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isInteger(value.account) ||
      value.account !== row.platform_account_id ||
      (bucket === 'settings' ? String(value.account) : value.id) !== key) {
      throw new PostError('post_state_invalid')
    }
    return { id, value: value as Tables[K] }
  }
  async function get<K extends Bucket>(bucket: K, key: string) {
    const rows = await http.records(await table(bucket), `(record_key,eq,${validKey(key)})`)
    if (rows.length > 1) throw new PostError('post_duplicate_rows')
    return rows[0] ? decode(bucket, rows[0]) : undefined
  }
  async function list<K extends Bucket>(bucket: K, account?: number) {
    const rows = await http.records(await table(bucket), account === undefined ? undefined :
      `(platform_account_id,eq,${account})`)
    const keys = new Set<unknown>()
    return rows.map(row => {
      if (keys.has(row.record_key)) throw new PostError('post_duplicate_rows')
      keys.add(row.record_key)
      return decode(bucket, row).value
    })
  }
  return { table, get, list }
}
