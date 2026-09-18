import type { RecordKey, SqlSession } from './contracts.mts';
import { PostgresReadError } from './contracts.mts';
import { encodeKey } from './records.mts';
import type { WorkingCatalog, WorkingTable } from './working-catalog.mts';
import { quoted, tableSql } from './working-catalog.mts';
import { checkedRecord, createKey, fields, projection } from './working-records.mts';
import { checkReferences, removeArchivedEdges } from './working-integrity.mts';
import { sourceFields } from './local-columns.mts';
import { automaticTimestamps } from './working-timestamps.mts';
import { assignGeneratedId } from './generated-ids.mts';
function one(table: WorkingTable, rows: Record<string, unknown>[]) {
  if (rows.length !== 1) throw new PostgresReadError(rows.length ? 'duplicate_record' : 'record_not_found');
  return checkedRecord(table, rows[0]);
}
export function workingCrud(session: SqlSession, catalog: WorkingCatalog) {
  return {
    async createRecord(tableId: string, input: Readonly<Record<string, unknown>>) {
      const table = catalog.get(tableId), data = structuredClone(input);
      fields(table, data, true);
      await assignGeneratedId(session, table, data);
      const values = fields(table, data, true), key = createKey(table, data);
      const automatic = automaticTimestamps(table, data, true);
      await checkReferences(session, catalog, table, data);
      let archive: string;
      try { archive = JSON.stringify(sourceFields(table.columns, data)); } catch { throw new PostgresReadError('invalid_fields'); }
      return one(table, (await session.query(`INSERT INTO ${tableSql(table)} AS t
        (${[...values.map(v => quoted(v.column.sqlName)), ...automatic.map(c => quoted(c.sqlName))].join(',')},_copy_id,_copy_source)
        VALUES (${[...values.map((v, i) => `$${i + 1}::${v.column.sqlType}`), ...automatic.map(() => 'statement_timestamp()')].join(',')},$${values.length + 1},$${values.length + 2}::jsonb)
        RETURNING ${projection(table)}`, [...values.map(v => v.value), key, archive])).rows);
    },
    async patchRecord(tableId: string, recordKey: RecordKey, input: Readonly<Record<string, unknown>>) {
      const table = catalog.get(tableId), key = encodeKey(table, recordKey), data = structuredClone(input), values = fields(table, data);
      const automatic = automaticTimestamps(table, data, false);
      await checkReferences(session, catalog, table, data, undefined, key);
      return one(table, (await session.query(`UPDATE ${tableSql(table)} AS t SET ${[...values.map((v, i) =>
        `${quoted(v.column.sqlName)}=$${i + 2}::${v.column.sqlType}`), ...automatic.map(c => `${quoted(c.sqlName)}=statement_timestamp()`)].join(',')}
        WHERE t._copy_id=$1 RETURNING ${projection(table)}`, [key, ...values.map(v => v.value)])).rows);
    },
    async deleteRecord(tableId: string, recordKey: RecordKey) {
      const table = catalog.get(tableId), key = encodeKey(table, recordKey);
      await checkReferences(session, catalog, table, {}, key);
      await removeArchivedEdges(session, catalog, table, key);
      const result = await session.query(`DELETE FROM ${tableSql(table)} AS t WHERE t._copy_id=$1 RETURNING ${projection(table)}`, [key]);
      if (result.rows.length > 1) throw new PostgresReadError('duplicate_record');
      return result.rows.length === 1;
    }
  };
}
