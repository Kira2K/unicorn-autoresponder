import { combinedFixture } from './combined-fixture.mts';
import { COPY_MARKER } from '../../../../integrations/postgres/contracts.mts';
import type { SqlPool } from '../../../../integrations/postgres/contracts.mts';

export function runtimeFixture() {
  const f = combinedFixture(), calls: string[] = [];
  const definitions = f.db.listTables().map(t => {
    const columns = t.columns.map((c, i) => ({ ...c, sqlName: 'c' + i,
      sqlType: c.title === 'Id' ? 'bigint' : c.sqlType ?? 'text', pk: c.title === 'Id' }));
    return { ...t, table_name: t.title, sqlTable: `noco.${t.id}`, columns,
      mapping: columns.map(c => ({ id: c.id, title: c.title, sqlName: c.sqlName, sqlType: c.sqlType })) };
  });
  const state = { ready: true, ends: 0 };
  const pool: SqlPool = { async end() { state.ends++; }, async connect() {
    return { release() {}, async query(text) {
      calls.push(text);
      if (text.includes('current_database()')) return { rows: [{ database: 'unicorn_noco_copy_restore', marker: COPY_MARKER }] };
      if (text.includes('copy_meta.inventory')) return { rows: definitions.map(definition => ({ definition })) };
      if (text.includes('has_sequence_privilege')) return { rows: [{ ready: state.ready }] };
      return { rows: [] };
    } };
  } };
  const env = { APP_DB: 'postgres', APP_DB_POSTGRES_DATABASE: 'unicorn_noco_copy_restore',
    APP_DB_POSTGRES_HOST: '127.0.0.1', APP_DB_POSTGRES_PORT: '5432', APP_DB_POSTGRES_USER: 'fake', APP_DB_POSTGRES_PASSWORD: 'fake' };
  return { f, pool, env, state, calls };
}
