import { COPY_MARKER } from './contracts.mts';
import type { SqlPool, TableInfo } from './contracts.mts';
export const table: TableInfo = { id: 'mpeople', title: 'clients', table_name: 'clients', columns: [
  { id: 'cid', title: 'Id', pk: true },
  { id: 'cfriends', title: 'Friends', uidt: 'Links', colOptions: { fk_related_model_id: 'mpeople' } },
  { id: 'ccrm', title: 'CRM', uidt: 'Links', colOptions: { fk_related_model_id: 'mcrm' } }
] };
export const crm: TableInfo = { ...table, id: 'mcrm', title: 'CRM', table_name: 'linkedin_manager_tasks' };
export function fakePool() {
  const state = { database: 'unicorn_noco_copy', marker: COPY_MARKER, connects: 0, released: [] as boolean[],
    calls: [] as { text: string; values: unknown[] }[], metadata: structuredClone([table, crm]), fail: '',
    records: [1, 2, 3].map(n => ({ record_key: JSON.stringify([String(n)]), source_json: JSON.stringify({ Id: n, name: '' }) })) };
  const pool: SqlPool = { async end() {}, async connect() {
    state.connects++;
    if (state.fail === 'connect') throw new Error('SECRET connect error');
    return { release(destroy = false) { state.released.push(destroy); }, async query(text, values = []) {
      state.calls.push({ text, values });
      if (state.fail && text.includes(state.fail)) throw new Error('SECRET row SQL password');
      if (text.includes('current_database()')) return { rows: [{ database: state.database, marker: state.marker }] };
      if (text.includes('copy_meta.inventory')) return { rows: state.metadata.map(definition => ({ definition })) };
      if (text.includes('FROM noco.')) {
        if (text.includes('WHERE _copy_id=$1')) return { rows: state.records.filter(r => r.record_key === values[0]) };
        const related = text.includes(' JOIN noco.'), after = values[related ? 1 : 0];
        const limit = Number(values[related ? 2 : 1]);
        return { rows: state.records.filter(r => after === null || r.record_key > String(after)).slice(0, limit) };
      }
      return { rows: [] };
    } };
  } };
  return { pool, state };
}
