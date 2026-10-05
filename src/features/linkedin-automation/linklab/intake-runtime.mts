import type { CopyDatabase, SqlPool } from '../../../integrations/postgres/contracts.mts';
import { createReadSession } from '../../../integrations/postgres/read-session.mts';
import { createWorkingCatalog, tableSql } from '../../../integrations/postgres/working-catalog.mts';
import { encodeKey } from '../../../integrations/postgres/records.mts';
import { workingReads } from '../../../integrations/postgres/working-reads.mts';
import { workingCrud } from '../../../integrations/postgres/working-crud.mts';
import { workingLinks } from '../../../integrations/postgres/working-links.mts';
import { workingLocks } from '../../../integrations/postgres/working-locks.mts';
import { writeTransaction } from '../../../integrations/postgres/working-session.mts';
import { createLinkLabIntake } from './intake.mts';

/** Opt-in composition. Uses the same SQL catalogue/CRUD, never changes the shared SQL client. */
export async function openLinkLabIntake(pool: SqlPool, database: CopyDatabase, cvTableId: string) {
  const catalog = await createReadSession(pool, database)(async sql => {
    await sql.query('SELECT handoff FROM noco.linklab_changes LIMIT 0');
    await sql.query('SELECT approved_at FROM noco.linklab_cv_approvals LIMIT 0');
    return createWorkingCatalog((await sql.query(
      "SELECT definition FROM copy_meta.inventory WHERE definition ? 'sqlTable' OR definition ? 'sqlOnlyFor' ORDER BY id")).rows);
  });
  return createLinkLabIntake(run => writeTransaction(pool, database, sql => run(sql, {
    ...workingReads(sql, catalog), ...workingCrud(sql, catalog),
    ...workingLinks(sql, catalog), ...workingLocks(sql, catalog)
  })), cvTableId, (sql, id) => sql.query(
    `SELECT _copy_id FROM ${tableSql(catalog.get(cvTableId))} WHERE _copy_id=$1 FOR UPDATE`,
    [encodeKey(catalog.get(cvTableId), [String(id)])]));
}
