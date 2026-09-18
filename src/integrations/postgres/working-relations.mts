import { PostgresReadError } from './contracts.mts';
import type { WorkingCatalog } from './working-catalog.mts';
import { quoted, tableSql } from './working-catalog.mts';
export function relation(catalog: WorkingCatalog, tableId: string, fieldId: string) {
  const source = catalog.get(tableId), field = source.columns.find(c => c.id === fieldId);
  const o = field?.colOptions;
  if (!o || !['Links', 'LinkToAnotherRecord'].includes(field?.uidt ?? '')) throw new PostgresReadError('relation_not_allowed');
  const target = catalog.get(String(o.fk_related_model_id));
  const child = catalog.column(o.fk_child_column_id), parent = catalog.column(o.fk_parent_column_id);
  if (o.type === 'bt' || o.type === 'hm') {
    const forward = o.type === 'bt';
    if (child.table.id !== (forward ? source.id : target.id) || parent.table.id !== (forward ? target.id : source.id))
      throw new PostgresReadError('invalid_relation_mapping');
    const left = forward ? child.column : parent.column, right = forward ? parent.column : child.column;
    return { source, target, child, parent, forward, junction: null,
      join: `JOIN ${tableSql(target)} t ON s.${quoted(left.sqlName)}=t.${quoted(right.sqlName)}` };
  }
  if (!['mm', 'om', 'mo'].includes(String(o.type))) throw new PostgresReadError('unsupported_relation');
  const junction = catalog.get(String(o.fk_mm_model_id));
  const mc = catalog.column(o.fk_mm_child_column_id), mp = catalog.column(o.fk_mm_parent_column_id);
  if (child.table.id !== source.id || parent.table.id !== target.id || mc.table.id !== junction.id || mp.table.id !== junction.id)
    throw new PostgresReadError('invalid_relation_mapping');
  return { source, target, child, parent, forward: true, junction: { table: junction, mc: mc.column, mp: mp.column },
    join: `JOIN ${tableSql(junction)} j ON s.${quoted(child.column.sqlName)}=j.${quoted(mc.column.sqlName)}
      JOIN ${tableSql(target)} t ON j.${quoted(mp.column.sqlName)}=t.${quoted(parent.column.sqlName)}` };
}
