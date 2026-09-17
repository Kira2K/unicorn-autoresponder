import type { SqlPool, CopyDatabase } from './contracts.mts';
import { PostgresReadError } from './contracts.mts';
import type { WorkingTable } from './working-catalog.mts';
import { tableSql } from './working-catalog.mts';
import { generatedIdColumn } from './generated-ids.mts';
import { createReadSession } from './read-session.mts';

export async function assertGeneratedIds(pool: SqlPool, database: CopyDatabase, tables: readonly WorkingTable[]) {
  return createReadSession(pool, database)(async session => {
    for (const table of tables) {
      const column = generatedIdColumn(table);
      const result = await session.query(`SELECT sequence IS NOT NULL AND
        has_sequence_privilege(sequence,'USAGE') AS ready FROM
        (SELECT pg_get_serial_sequence($1,$2) AS sequence) s`, [tableSql(table), column.sqlName]);
      if (result.rows.length !== 1 || result.rows[0].ready !== true)
        throw new PostgresReadError('postgres_id_allocator_required:' + table.id);
    }
  });
}
