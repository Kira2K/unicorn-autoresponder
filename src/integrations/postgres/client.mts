import { PostgresReadError } from './contracts.mts';
import type { CopyDatabase, PageOptions, RecordKey, SqlPool } from './contracts.mts';
import { createReadSession } from './read-session.mts';
import { createCatalog, identifier, tableSql } from './catalog.mts';
import { decodeRecord, encodeKey, pageSize, recordPage } from './records.mts';
export async function createPostgresReadClient(pool: SqlPool, database: CopyDatabase) {
  const read = createReadSession(pool, database);
  const catalog = await read(async session => createCatalog((await session.query(
    "SELECT definition FROM copy_meta.inventory WHERE definition ? 'sqlTable' ORDER BY id")).rows));
  return {
    listTables: catalog.list,
    async getRecord(tableId: string, key: RecordKey) {
      const table = catalog.get(tableId), id = encodeKey(table, key);
      return read(async session => {
        const result = await session.query(`SELECT _copy_id AS record_key, _copy_source::text AS source_json
          FROM ${tableSql(table)} WHERE _copy_id=$1`, [id]);
        if (result.rows.length > 1) throw new PostgresReadError('duplicate_record');
        return result.rows[0] ? decodeRecord(result.rows[0]) : null;
      });
    },
    async listRecords(tableId: string, options: PageOptions = {}) {
      const table = catalog.get(tableId), limit = pageSize(options);
      const after = options.after ? encodeKey(table, options.after) : null;
      return read(async session => recordPage((await session.query(
        `SELECT _copy_id AS record_key, _copy_source::text AS source_json FROM ${tableSql(table)}
          WHERE ($1::text IS NULL OR _copy_id COLLATE "C" > $1 COLLATE "C")
          ORDER BY _copy_id COLLATE "C" LIMIT $2`, [after, limit + 1])).rows, limit));
    },
    async listRelated(tableId: string, fieldId: string, key: RecordKey, options: PageOptions = {}) {
      const table = catalog.get(tableId), source = encodeKey(table, key), limit = pageSize(options);
      const field = table.columns.find(c => c.id === fieldId && ['Links', 'LinkToAnotherRecord'].includes(c.uidt ?? ''));
      if (!field?.colOptions?.fk_related_model_id) throw new PostgresReadError('relation_not_allowed');
      const target = catalog.get(field.colOptions.fk_related_model_id);
      const after = options.after ? encodeKey(target, options.after) : null;
      return read(async session => recordPage((await session.query(
        `SELECT t._copy_id AS record_key, t._copy_source::text AS source_json
          FROM noco.${identifier('link_' + field.id)} e JOIN ${tableSql(target)} t ON t._copy_id=e.target_id
          WHERE e.source_id=$1 AND ($2::text IS NULL OR e.target_id COLLATE "C" > $2 COLLATE "C")
          ORDER BY e.target_id COLLATE "C" LIMIT $3`, [source, after, limit + 1])).rows, limit));
    }
  };
}
