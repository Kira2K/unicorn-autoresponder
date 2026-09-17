import { isDeepStrictEqual } from 'node:util';
import { PostError } from '../post-writer/errors.ts';
import { validKey, tableNames, decodePostRow } from '../post-writer/noco-rows.ts';
import { columns } from '../../../integrations/noco/linkedin-post-writer-schema/contract.ts';
import type { PostStore, Tables } from '../post-writer/types.ts';
import type { FeatureSql, FeatureWrites } from './contracts.mts';
import { createFeatureRows } from './rows.mts';
type Bucket = keyof Tables;
export function createSqlPostStore(db: FeatureSql, grant?: FeatureWrites): PostStore {
  const stores = { settings: createFeatureRows(db, tableNames.settings, columns, grant, [0]),
    runs: createFeatureRows(db, tableNames.runs, columns, grant), history: createFeatureRows(db, tableNames.history, columns, grant) };
  async function get<K extends Bucket>(bucket: K, key: string, rows = stores[bucket]) {
    const found = await rows.list('record_key', [validKey(key)]);
    if (found.length > 1) throw new PostError('post_duplicate_rows');
    return found[0] ? decodePostRow(bucket, found[0]) : undefined;
  }
  async function save<K extends Bucket>(bucket: K, key: string, incoming: Tables[K], claim = false) {
    validKey(key);
    const value: Tables[K] = JSON.parse(JSON.stringify(incoming));
    decodePostRow(bucket, { Id: 1, record_key: key, platform_account_id: value.account, state_json: JSON.stringify(value) });
    return stores[bucket].atomic(key, async rows => {
      const found = await rows.list('record_key', [key]);
      if (found.length > 1) throw new PostError('post_duplicate_rows');
      const existing = found[0] && decodePostRow(bucket, found[0]);
      if (existing && (claim || isDeepStrictEqual(existing.value, value))) return { value: existing.value, created: false };
      if (existing) await rows.patch(existing.id, { state_json: JSON.stringify(value) });
      else await rows.insert({ record_key: key, platform_account_id: value.account, state_json: JSON.stringify(value) });
      const confirmed = await rows.list('record_key', [key]);
      if (confirmed.length !== 1 || !isDeepStrictEqual(decodePostRow(bucket, confirmed[0]).value, value))
        throw new PostError('post_noco_unconfirmed');
      return { value, created: !existing };
    });
  }
  return { get: async (bucket, key) => (await get(bucket, key))?.value,
    async list(bucket, account) {
      const found = await stores[bucket].list(account === undefined ? undefined : 'platform_account_id', account === undefined ? [] : [String(account)]);
      const keys = new Set<unknown>();
      return found.map(row => {
        if (keys.has(row.record_key)) throw new PostError('post_duplicate_rows');
        keys.add(row.record_key); return decodePostRow(bucket, row).value;
      });
    },
    async put(bucket, key, value) { await save(bucket, key, value); },
    claim: (key, value) => save('history', key, value, true)
  };
}
