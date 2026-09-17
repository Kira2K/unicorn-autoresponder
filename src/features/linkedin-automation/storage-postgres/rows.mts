import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import type { CopyRecord } from '../../../integrations/postgres/contracts.mts';
import type { PostgresTransaction } from '../../../integrations/postgres/working-client.mts';
import { readPages } from '../../../platform/db/postgres/pages.mts';
import { appDbRow } from '../../../platform/db/postgres/record-relations.mts';
import type { FeatureSql, FeatureRow, FeatureWrites } from './contracts.mts';
export function createFeatureRows(db: FeatureSql, title: string, fields: readonly { title: string }[], grant?: FeatureWrites,
  sharedReadAccounts: readonly number[] = []) {
  const matches = db.listTables().filter(t => t.title === title), table = matches[0];
  if (matches.length !== 1) throw new PostgresReadError('sql_feature_table_required:' + title);
  for (const field of ['Id', ...fields.map(c => c.title)])
    if (table.columns.filter(c => c.title === field).length !== 1) throw new PostgresReadError('sql_feature_column_required:' + title + ':' + field);
  const scoped = table.columns.some(c => c.title === 'platform_account_id');
  const readable = new Set([...grant?.accountIds ?? [], ...sharedReadAccounts]);
  const allowed = (row: Record<string, unknown>) => !grant || grant.allAccounts || !scoped || readable.has(Number(row.platform_account_id));
  const payload = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data)
    .filter(([, value]) => value !== undefined).map(([key, value]) => [key, value === '' &&
      table.columns.some(c => c.dataKey === key && ['date','timestamptz'].includes(c.sqlType)) ? null : value]));
  function decode(record: CopyRecord): FeatureRow {
    const row = appDbRow(record);
    for (const c of table.columns) if (c.sqlType === 'timestamptz' && typeof row[c.dataKey] === 'string')
      row[c.dataKey] = String(row[c.dataKey]).replace(/^(\d{4}-\d{2}-\d{2})T/, '$1 ');
    return row;
  }
  function access(tx?: PostgresTransaction) {
    const sql = tx ?? db;
    const all = () => readPages(after => sql.listRecords(table.id, { limit: 100, after }));
    const find = (field: string, values: readonly string[]) => readPages(after => sql.findRecords(table.id, field, values, { limit: 100, after }));
    async function list(field?: string, values: readonly string[] = []): Promise<FeatureRow[]> {
      const raw = field ? await find(field, values) : grant && !grant.allAccounts && scoped
        ? await find('platform_account_id', [...readable].map(String)) : await all();
      return raw.map(decode).filter(allowed).sort((a, b) => a.Id - b.Id);
    }
    function assertWrite(row: Record<string, unknown>) {
      const account = Number(row.platform_account_id);
      if (!grant || !scoped || !Number.isSafeInteger(account) || account < 0 ||
        (!grant.allAccounts && !grant.accountIds.has(account))) throw new PostgresReadError('sql_test_write_forbidden');
    }
    const write = <T,>(operation: (session: PostgresTransaction) => Promise<T>) => tx ? operation(tx) : db.transaction(operation);
    return { list,
      async insert(data: Record<string, unknown>) {
        assertWrite(data);
        return write(async session => decode(await grant!.create(session, table.id, payload(data))));
      },
      async patch(id: number, data: Record<string, unknown>) {
        return write(async session => {
          const current = await session.getRecord(table.id, [String(id)]);
          if (!current) throw new PostgresReadError('record_not_found');
          assertWrite(current.data);
          if ('platform_account_id' in data && Number(data.platform_account_id) !== Number(current.data.platform_account_id))
            throw new PostgresReadError('sql_owner_immutable');
          return decode(await session.patchRecord(table.id, [String(id)], payload(data)));
        });
      },
      async remove(id: number) {
        return write(async session => {
          const current = await session.getRecord(table.id, [String(id)]);
          if (!current) return;
          assertWrite(current.data); await session.deleteRecord(table.id, [String(id)]);
        });
      }
    };
  }
  return { ...access(), async atomic<T>(key: string, operation: (rows: ReturnType<typeof access>) => Promise<T>): Promise<T> {
    if (!grant) throw new PostgresReadError('sql_test_write_forbidden');
    return db.transaction(async tx => { await tx.lockKey(table.id, key); return operation(access(tx)); });
  } };
}
