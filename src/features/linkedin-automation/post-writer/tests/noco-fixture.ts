import type { NocoTransport } from '../noco-transport.ts'
import { tableNames } from '../noco-store.ts'
import { columns } from '../../../../integrations/noco/linkedin-post-writer-schema/contract.ts'
export function nocoFixture() {
  const saved = new Map<string, Record<string, unknown>[]>()
  const calls: { method: string; path: string; body?: unknown }[] = []
  let timeout = false
  const http: NocoTransport = {
    baseId: 'test',
    async request(method, path, body) {
      calls.push({ method, path, body })
      if (path.includes('/meta/bases/')) return Object.values(tableNames).map(title => ({ id: title, title }))
      if (path.includes('/meta/tables/')) return { columns: structuredClone(columns) }
      const table = path.split('/')[4]
      const rows = saved.get(table) ?? []
      if (method === 'POST') {
        const value = body as Record<string, unknown>
        rows.push({ Id: rows.length + 1, ...value })
        saved.set(table, rows)
        if (timeout) throw new Error('ambiguous response')
        return rows.at(-1)
      }
      if (method === 'PATCH') {
        const value = body as Record<string, unknown>
        Object.assign(rows.find(row => row.Id === value.Id)!, value)
        return value
      }
      throw new Error('unexpected request')
    },
    async records(table, where) {
      calls.push({ method: 'GET', path: table })
      const key = where?.match(/record_key,eq,([^)]+)/)?.[1]
      const account = where?.match(/platform_account_id,eq,(\d+)/)?.[1]
      return (saved.get(table) ?? []).filter(row => (!key || row.record_key === key) &&
        (!account || row.platform_account_id === Number(account)))
    }
  }
  return { http, calls, saved, setTimeout(value: boolean) { timeout = value } }
}
