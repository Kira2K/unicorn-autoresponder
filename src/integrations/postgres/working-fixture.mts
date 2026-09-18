import { COPY_MARKER } from './contracts.mts';
import type { SqlPool } from './contracts.mts';
const col = (id: string, title: string, sqlType = 'text', pk = false) =>
  ({ id, title, column_name: id, pk, uidt: pk ? 'ID' : 'SingleLineText', sqlName: id, sqlType });
export const people = { id: 'mpeople', title: 'clients', table_name: 'clients', columns: [
  col('cid', 'Id', 'bigint', true), col('cname', 'Name'), col('cmail', 'Email'),
  col('camount', 'Amount', 'numeric'), col('cdate', 'Date', 'date'), col('cjson', 'Json', 'jsonb'),
  { ...col('cteam', 'TeamId', 'bigint'), uidt: 'ForeignKey' },
  { id: 'cteamlink', title: 'Team', uidt: 'Links', colOptions: { type: 'bt',
    fk_related_model_id: 'mteams', fk_child_column_id: 'cteam', fk_parent_column_id: 'ctid' } }
] };
export const teams = { id: 'mteams', title: 'teams', table_name: 'teams', columns: [
  col('ctid', 'Id', 'bigint', true), col('ctname', 'Name'),
  { id: 'cpeople', title: 'People', uidt: 'Links', colOptions: { type: 'hm',
    fk_related_model_id: 'mpeople', fk_child_column_id: 'cteam', fk_parent_column_id: 'ctid' } }
] };
export const metadata = [people, teams].map(t => ({ ...t, sqlTable: `noco.${t.id}`,
  mapping: t.columns.map(c => ({ id: c.id, title: c.title,
    sqlName: 'sqlName' in c ? c.sqlName : 'v_' + c.id, sqlType: 'sqlType' in c ? c.sqlType : 'jsonb' })) }));
export function workingFake() {
  const state = { calls: [] as { text: string; values: unknown[] }[], releases: [] as boolean[],
    rows: [] as Record<string, unknown>[], definitions: structuredClone(metadata),
    fail: '', database: 'unicorn_noco_copy_restore', marker: COPY_MARKER };
  const pool: SqlPool = { async end() {}, async connect() {
    return { release(broken = false) { state.releases.push(broken); }, async query(text, values = []) {
      state.calls.push({ text, values });
      if (state.fail && text.includes(state.fail)) throw new Error('SECRET provider message');
      if (text.includes('current_database()')) return { rows: [{ database: state.database, marker: state.marker }] };
      if (text.includes('copy_meta.inventory')) return { rows: state.definitions.map(definition => ({ definition })) };
      if (text.includes('AS source_json')) return { rows: state.rows };
      return { rows: [] };
    } };
  } };
  return { pool, state };
}
