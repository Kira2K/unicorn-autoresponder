import { isDeepStrictEqual } from 'node:util'
import { PostError, retryDelay } from './errors.ts'
import { createSerialQueue } from './serial.ts'
import { createNocoRows, validKey } from './noco-rows.ts'
import type { PostStore, Tables } from './types.ts'
import type { NocoTransport } from './noco-transport.ts'
export { tableNames } from './noco-rows.ts'
type Bucket = keyof Tables
const persisted = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export function createPostNocoStore(http: NocoTransport): PostStore {
  const rows = createNocoRows(http)
  const serial = createSerialQueue()
  // Missing read-back is not evidence that an ambiguous POST failed.
  const unconfirmedCreates = new Set<string>()
  const keyOf = (bucket: Bucket, key: string) => `${bucket}:${validKey(key)}`
  async function create<K extends Bucket>(bucket: K, key: string, value: Tables[K]) {
    const token = keyOf(bucket, key)
    if (unconfirmedCreates.has(token)) throw new PostError('post_noco_create_uncertain')
    const path = `/api/v2/tables/${await rows.table(bucket)}/records`
    unconfirmedCreates.add(token)
    let accepted = false
    let failure: unknown
    try {
      await http.request('POST', path, { record_key: key, platform_account_id: value.account,
        state_json: JSON.stringify(value) })
      accepted = true
    } catch (error) { failure = error }
    const confirmed = await rows.get(bucket, key)
    if (!confirmed) throw new PostError('post_noco_create_uncertain', retryDelay(failure))
    unconfirmedCreates.delete(token)
    if (!isDeepStrictEqual(confirmed.value, value)) throw new PostError('post_noco_unconfirmed')
    return { value: confirmed.value, created: accepted }
  }
  return {
    async get(bucket, key) { return (await rows.get(bucket, key))?.value },
    list: rows.list,
    put(bucket, key, value) {
      const snapshot = persisted(value)
      return serial(keyOf(bucket, key), async () => {
        const existing = await rows.get(bucket, key)
        if (!existing) { await create(bucket, key, snapshot); return }
        unconfirmedCreates.delete(keyOf(bucket, key))
        if (isDeepStrictEqual(existing.value, snapshot)) return
        await http.request('PATCH', `/api/v2/tables/${await rows.table(bucket)}/records`,
          { Id: existing.id, state_json: JSON.stringify(snapshot) })
        const confirmed = await rows.get(bucket, key)
        if (!confirmed || !isDeepStrictEqual(confirmed.value, snapshot)) throw new PostError('post_noco_unconfirmed')
      })
    },
    claim(key, value) {
      const snapshot = persisted(value)
      return serial(keyOf('history', key), async () => {
        const existing = await rows.get('history', key)
        if (existing) return { value: existing.value, created: false }
        return create('history', key, snapshot)
      })
    }
  }
}
