import { isDeepStrictEqual } from 'node:util';
import type { CopyDatabase, SqlPool, SqlSession } from '../../../../integrations/postgres/contracts.mts';
import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
import { createReadSession } from '../../../../integrations/postgres/read-session.mts';
import { writeTransaction } from '../../../../integrations/postgres/working-session.mts';
import { createWorkingCatalog, tableSql } from '../../../../integrations/postgres/working-catalog.mts';
import { tableIds } from './tables.mts';
export const cvLocalKey = 'sql-only:cv-workflow:v1';
export const cvLocalColumns = ['last_responsible', 'last_workflow_error', 'workflow_trace'] as const;
export const cvLocalDefinition = { sqlOnlyFor: tableIds.cv, columns: cvLocalColumns.map(name => ({ name, sqlType: 'text' })) };
async function inspect(session: SqlSession) {
  const rows = (await session.query('SELECT id, definition FROM copy_meta.inventory WHERE id IN ($1,$2)', [tableIds.cv, cvLocalKey])).rows;
  const source = rows.find(r => r.id === tableIds.cv), existing = rows.find(r => r.id === cvLocalKey);
  if (!source) throw new PostgresReadError('cv_table_missing');
  const catalog = createWorkingCatalog([source, { definition: cvLocalDefinition }]), table = catalog.get(tableIds.cv);
  if (existing && !isDeepStrictEqual(existing.definition, cvLocalDefinition))
    throw new PostgresReadError('cv_local_definition_conflict');
  const columns = (await session.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema='noco' AND table_name=$1 AND column_name=ANY($2::text[])`, [table.sqlName ?? table.id, [...cvLocalColumns]])).rows;
  if ((!existing && columns.length) || (existing && (columns.length !== 3 || columns.some(c =>
    c.data_type !== 'text' || c.is_nullable !== 'YES' || c.column_default !== null))))
    throw new PostgresReadError('cv_local_columns_conflict');
  return { ready: Boolean(existing), columns: [...cvLocalColumns], sqlTable: tableSql(table) };
}
// Explicit operator action only; no startup migration and no Noco calls.
export async function ensureCvSqlColumns(pool: SqlPool, database: CopyDatabase, apply = false) {
  if (!apply) return createReadSession(pool, database)(async session => {
    const { ready, columns } = await inspect(session); return { ready, columns };
  });
  return writeTransaction(pool, database, async session => {
    await session.query("SET LOCAL ROLE unicorn_noco_copy_owner");
    await session.query("SET LOCAL lock_timeout='3s'");
    await session.query("SELECT pg_advisory_xact_lock(hashtextextended('unicorn:cv:sql-only:v1',0))");
    const before = await inspect(session);
    if (before.ready) return { ready: true, columns: before.columns, changed: false };
    await session.query(`ALTER TABLE ${before.sqlTable} ${cvLocalColumns.map(name => `ADD COLUMN "${name}" text`).join(', ')}`);
    await session.query('INSERT INTO copy_meta.inventory(id,definition) VALUES ($1,$2::jsonb)', [cvLocalKey, JSON.stringify(cvLocalDefinition)]);
    const after = await inspect(session);
    if (!after.ready) throw new PostgresReadError('cv_local_columns_not_verified');
    return { ready: true, columns: after.columns, changed: true };
  });
}
