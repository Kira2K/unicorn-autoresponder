import { assertCopyDatabase } from '../../integrations/postgres/read-session.mts';
import { createWorkingCatalog } from '../../integrations/postgres/working-catalog.mts';
import { workingReads } from '../../integrations/postgres/working-reads.mts';
import { PostgresReadError } from '../../integrations/postgres/contracts.mts';
import type { CopyDatabase,SqlPool,SqlSession } from '../../integrations/postgres/contracts.mts';
import { captureLegacySnapshot } from './legacy-snapshot.mts';

/** A consistent snapshot of current columns and links; never reads archived _copy_source values. */
export async function exportLegacySnapshot(pool:SqlPool,database:CopyDatabase) {
  let session:SqlSession|undefined,broken=false;
  try {
    session=await pool.connect();
    await session.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await assertCopyDatabase(session,database);
    const catalog=createWorkingCatalog((await session.query("SELECT definition FROM copy_meta.inventory WHERE definition ? 'sqlTable' OR definition ? 'sqlOnlyFor' ORDER BY id")).rows);
    const reader={...workingReads(session,catalog),listTables:()=>catalog.list().map(t=>catalog.get(t.id))};
    return await captureLegacySnapshot(reader);
  }catch(error) {
    broken=true;
    if(error instanceof PostgresReadError)throw error;
    throw new PostgresReadError('legacy_export_failed');
  }finally {
    if(session){try{await session.query('ROLLBACK');}catch{broken=true;}session.release(broken);}
  }
}
