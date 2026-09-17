import type { RecordKey, SqlSession } from './contracts.mts';
import { PostgresReadError } from './contracts.mts';
import type { WorkingCatalog } from './working-catalog.mts';
import { tableSql } from './working-catalog.mts';
import { relation } from './working-relations.mts';
import { workingReads } from './working-reads.mts';
import { workingCrud } from './working-crud.mts';
export function workingLinks(session: SqlSession, catalog: WorkingCatalog) {
  const read = workingReads(session, catalog), crud = workingCrud(session, catalog);
  async function change(tableId: string, fieldId: string, sourceKey: RecordKey, targetKey: RecordKey, add: boolean) {
    const r = relation(catalog, tableId, fieldId);
    const tables = new Map([r.source, r.target, ...(r.junction ? [r.junction.table] : [])].map(t => [t.id, t]));
    await session.query(`LOCK TABLE ${[...tables.values()].sort((a, b) => a.id.localeCompare(b.id)).map(tableSql).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
    const source = await read.getRecord(r.source.id, sourceKey), target = await read.getRecord(r.target.id, targetKey);
    if (!source || !target) throw new PostgresReadError('record_not_found');
    if (r.junction) {
      const { table, mc, mp } = r.junction;
      const data = { [mc.dataKey]: source.data[r.child.column.dataKey], [mp.dataKey]: target.data[r.parent.column.dataKey] };
      const key = table.columns.filter(c => c.pk).map(c => {
        if (data[c.dataKey] == null) throw new PostgresReadError('junction_key_required');
        return String(data[c.dataKey]);
      });
      const existing = await read.getRecord(table.id, key);
      if (add && !existing) await crud.createRecord(table.id, data);
      if (!add && existing) await crud.deleteRecord(table.id, key);
    } else {
      const child = r.forward ? source : target, parent = r.forward ? target : source;
      const expected = parent.data[r.parent.column.dataKey], current = child.data[r.child.column.dataKey];
      if (add || (current != null && String(current) === String(expected)))
        await crud.patchRecord(r.child.table.id, child.key, { [r.child.column.dataKey]: add ? expected : null });
    }
  }
  return {
    linkRecord: (table: string, field: string, source: RecordKey, target: RecordKey) => change(table, field, source, target, true),
    unlinkRecord: (table: string, field: string, source: RecordKey, target: RecordKey) => change(table, field, source, target, false)
  };
}
