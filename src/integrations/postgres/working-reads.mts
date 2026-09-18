import type { PageOptions, RecordKey, SqlSession } from './contracts.mts';
import { PostgresReadError } from './contracts.mts';
import { encodeKey, pageSize, recordPage } from './records.mts';
import type { WorkingCatalog, WorkingTable } from './working-catalog.mts';
import { tableSql, quoted } from './working-catalog.mts';
import { checkedRecord, checkKey, projection, physicalColumns } from './working-records.mts';
import { relation } from './working-relations.mts';
export function workingReads(session: SqlSession, catalog: WorkingCatalog) {
  function page(table: WorkingTable, rows: Record<string, unknown>[], limit: number) {
    const result = recordPage(rows, limit), seen = new Set<string>();
    for (const record of result.records) {
      checkKey(table, record); const id = JSON.stringify(record.key);
      if (seen.has(id)) throw new PostgresReadError('duplicate_record'); seen.add(id);
    }
    return result;
  }
  return {
    async findRecords(tableId: string, field: string, values: readonly string[], options: PageOptions & { trim?: boolean } = {}) {
      const t = catalog.get(tableId), column = physicalColumns(t).find(c => c.dataKey === field);
      if (!column) throw new PostgresReadError('field_not_searchable');
      if (!Array.isArray(values) || values.length > 1000 || values.some(v => typeof v !== 'string'))
        throw new PostgresReadError('invalid_lookup_values');
      const limit = pageSize(options), after = options.after ? encodeKey(t, options.after) : null;
      if (!values.length) return { records: [], nextKey: null };
      const value = `t.${quoted(column.sqlName)}::text`;
      const expression = options.trim ? `btrim(COALESCE(${value},''))` : value;
      return page(t, (await session.query(`SELECT ${projection(t)} FROM ${tableSql(t)} t
        WHERE ${expression}=ANY($1::text[]) AND ($2::text IS NULL OR t._copy_id COLLATE "C" > $2 COLLATE "C")
        ORDER BY t._copy_id COLLATE "C" LIMIT $3`, [[...new Set(values)], after, limit + 1])).rows, limit);
    },
    async getRecord(tableId: string, key: RecordKey) {
      const t = catalog.get(tableId), id = encodeKey(t, key);
      const result = await session.query(`SELECT ${projection(t)} FROM ${tableSql(t)} t WHERE t._copy_id=$1`, [id]);
      if (result.rows.length > 1) throw new PostgresReadError('duplicate_record');
      return result.rows[0] ? checkedRecord(t, result.rows[0]) : null;
    },
    async listRecords(tableId: string, options: PageOptions = {}) {
      const t = catalog.get(tableId), limit = pageSize(options), after = options.after ? encodeKey(t, options.after) : null;
      return page(t, (await session.query(`SELECT ${projection(t)} FROM ${tableSql(t)} t
        WHERE ($1::text IS NULL OR t._copy_id COLLATE "C" > $1 COLLATE "C")
        ORDER BY t._copy_id COLLATE "C" LIMIT $2`, [after, limit + 1])).rows, limit);
    },
    async listRelated(tableId: string, fieldId: string, key: RecordKey, options: PageOptions = {}) {
      const r = relation(catalog, tableId, fieldId), id = encodeKey(r.source, key), limit = pageSize(options);
      const after = options.after ? encodeKey(r.target, options.after) : null;
      return page(r.target, (await session.query(`SELECT ${projection(r.target)} FROM ${tableSql(r.target)} t
        WHERE t._copy_id IN (SELECT t._copy_id FROM ${tableSql(r.source)} s ${r.join} WHERE s._copy_id=$1)
        AND ($2::text IS NULL OR t._copy_id COLLATE "C" > $2 COLLATE "C")
        ORDER BY t._copy_id COLLATE "C" LIMIT $3`, [id, after, limit + 1])).rows, limit);
    }
  };
}
