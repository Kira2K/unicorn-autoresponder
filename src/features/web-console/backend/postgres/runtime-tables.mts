import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
import type { ConsoleSql } from './contracts.mts';
import { tableIds } from './tables.mts';

// Only tables that the normal application creates rows in. No dashboard/CRM schema changes.
export function runtimeCreateTables(db: Pick<ConsoleSql, 'listTables'>) {
  const tables = db.listTables(), result = [tableIds.accounts, tableIds.profiles, tableIds.cv].map(id => {
    const table = tables.find(t => t.id === id);
    if (!table) throw new PostgresReadError('sql_runtime_table_required:' + id);
    return table;
  });
  for (const title of ['linkedin_auth_runs', 'linkedin_profile_jobs', 'linkedin_comment_monitor_jobs',
    'linkedin_connection_runs', 'linkedin_connection_history', 'linkedin_post_settings', 'linkedin_post_runs', 'linkedin_post_history']) {
    const found = tables.filter(t => t.title === title);
    if (found.length !== 1) throw new PostgresReadError('sql_runtime_table_required:' + title);
    result.push(found[0]);
  }
  return result;
}
