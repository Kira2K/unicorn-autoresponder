import type { SqlSession } from './contracts.mts';
import { PostgresReadError } from './contracts.mts';
import type { WorkingCatalog, WorkingTable } from './working-catalog.mts';
import { quoted, tableSql } from './working-catalog.mts';
import { parameter } from './working-records.mts';
export function references(catalog: WorkingCatalog, table: WorkingTable, incoming: boolean,
  data?: Readonly<Record<string, unknown>>) {
  const found = new Map<string, { child: ReturnType<WorkingCatalog['column']>; parent: ReturnType<WorkingCatalog['column']> }>();
  for (const owner of catalog.list()) for (const field of owner.columns) {
    const o = field.colOptions as Record<string, unknown> | undefined;
    if (!o) continue;
    const pairs = ['bt', 'hm'].includes(String(o.type)) ? [[o.fk_child_column_id, o.fk_parent_column_id]]
      : ['mm', 'om', 'mo'].includes(String(o.type)) ? [[o.fk_mm_child_column_id, o.fk_child_column_id],
        [o.fk_mm_parent_column_id, o.fk_parent_column_id]] : [];
    for (const [childId, parentId] of pairs) {
      const involved = table.columns.find(c => c.id === (incoming ? parentId : childId));
      if (!involved || (data && (!Object.hasOwn(data, involved.dataKey) || data[involved.dataKey] === null))) continue;
      const child = catalog.column(childId), parent = catalog.column(parentId);
      found.set(child.column.id + ':' + parent.column.id, { child, parent });
    }
  }
  return [...found.values()];
}
export async function checkReferences(session: SqlSession, catalog: WorkingCatalog, table: WorkingTable,
  data: Readonly<Record<string, unknown>>, deleting?: string, updating?: string) {
  const refs = references(catalog, table, deleting !== undefined, deleting === undefined ? data : undefined);
  for (const c of table.columns.filter(c => c.uidt === 'ForeignKey' && Object.hasOwn(data, c.dataKey) && data[c.dataKey] !== null))
    if (!refs.some(r => r.child.column.id === c.id)) throw new PostgresReadError('unmapped_foreign_key');
  // The imported schema has no native business FKs. Lock the affected tables while checking/writing.
  const locked = new Map([[table.id, table]]);
  for (const r of refs) { locked.set(r.child.table.id, r.child.table); locked.set(r.parent.table.id, r.parent.table); }
  await session.query(`LOCK TABLE ${[...locked.values()].sort((a, b) => a.id.localeCompare(b.id)).map(tableSql).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
  for (const r of refs) {
    const { child, parent } = r;
    const result = deleting !== undefined
      ? await session.query(`SELECT 1 FROM ${tableSql(child.table)} c JOIN ${tableSql(parent.table)} p
          ON c.${quoted(child.column.sqlName)}=p.${quoted(parent.column.sqlName)} WHERE p._copy_id=$1 LIMIT 1`, [deleting])
      : await session.query(`SELECT 1 FROM ${tableSql(parent.table)} WHERE ${quoted(parent.column.sqlName)}=$1::${parent.column.sqlType} LIMIT 2`,
          [parameter(parent.column, data[child.column.dataKey])]);
    if (deleting !== undefined ? result.rows.length > 0 : result.rows.length !== 1)
      throw new PostgresReadError(deleting !== undefined ? 'record_is_referenced' : 'invalid_reference');
  }
  const checked = new Set<string>();
  for (const owner of catalog.list()) for (const field of owner.columns) {
    const o = field.colOptions as Record<string, unknown> | undefined;
    if (!o || o.fk_mm_model_id !== table.id || !['om', 'mo'].includes(String(o.type))) continue;
    const id = o.type === 'om' ? o.fk_mm_parent_column_id : o.fk_mm_child_column_id;
    const c = table.columns.find(c => c.id === id);
    if (!c || !Object.hasOwn(data, c.dataKey) || data[c.dataKey] === null || checked.has(c.id)) continue;
    checked.add(c.id);
    const rows = (await session.query(`SELECT 1 FROM ${tableSql(table)} WHERE ${quoted(c.sqlName)}=$1::${c.sqlType}
      AND ($2::text IS NULL OR _copy_id<>$2) LIMIT 1`, [parameter(c, data[c.dataKey]), updating ?? null])).rows;
    if (rows.length) throw new PostgresReadError('relation_already_linked');
  }
}
export async function removeArchivedEdges(session: SqlSession, catalog: WorkingCatalog, table: WorkingTable, key: string) {
  for (const owner of catalog.list()) for (const c of owner.columns) {
    if (!['Links', 'LinkToAnotherRecord'].includes(c.uidt ?? '')) continue;
    const target = c.colOptions?.fk_related_model_id;
    if (owner.id !== table.id && target !== table.id) continue;
    // Do not modify an archived edge to a protected/unknown table.
    catalog.get(String(target));
    const conditions = [owner.id === table.id ? 'source_id=$1' : '', target === table.id ? 'target_id=$1' : ''].filter(Boolean);
    await session.query(`DELETE FROM noco.${quoted('link_' + c.id)} WHERE ${conditions.join(' OR ')}`, [key]);
  }
}
