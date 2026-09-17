import type { Column, Row, Table } from './contracts.mts';
import { primaryKeys } from './contracts.mts';
import { canonical, scalar } from './json.mts';
export interface Edge { field: string; source: string; target: string; }
export function rowKey(table: Table, row: Row): string {
  return canonical(primaryKeys(table).map(c => scalar(row[c.title])));
}
export function buildRelations(tables: Table[], data: Map<string, Row[]>,
  sourceIssues: { field: string; source: string; kind: string }[] = []): Edge[] {
  const fields = new Map(tables.flatMap(table => table.columns.map(column => [column.id, { table, column }] as const)));
  const edges: Edge[] = [];
  for (const table of tables) for (const field of table.columns) {
    if (!['Links', 'LinkToAnotherRecord'].includes(field.uidt)) continue;
    const option = field.colOptions;
    if (!option) throw new Error(`missing_relation_definition:${field.id}`);
    const target = tables.find(t => t.id === option.fk_related_model_id);
    if (!target) throw new Error(`missing_relation_table:${field.id}`);
    const column = (id: unknown) => {
      const found = fields.get(String(id));
      if (!found) throw new Error(`missing_relation_column:${field.id}`);
      return found;
    };
    const child = column(option.fk_child_column_id), parent = column(option.fk_parent_column_id);
    const values = (t: Table) => data.get(t.id) ?? [];
    for (const sourceRow of values(table)) {
      let targets: Row[];
      const equal = (a: Row, ac: Column, b: Row, bc: Column) =>
        a[ac.title] !== null && a[ac.title] !== undefined && canonical(a[ac.title]) === canonical(b[bc.title]);
      if (option.type === 'hm') targets = values(target).filter(row => equal(sourceRow, parent.column, row, child.column));
      else if (option.type === 'bt') targets = values(target).filter(row => equal(sourceRow, child.column, row, parent.column));
      else if (['mm', 'om', 'mo'].includes(String(option.type)) && option.fk_mm_model_id) {
        const mc = column(option.fk_mm_child_column_id), mp = column(option.fk_mm_parent_column_id);
        const junction = tables.find(t => t.id === option.fk_mm_model_id);
        if (!junction) throw new Error(`missing_junction:${field.id}`);
        targets = values(junction).filter(row => equal(sourceRow, child.column, row, mc.column)).flatMap(link => {
          const found = values(target).filter(row => equal(link, mp.column, row, parent.column));
          if (!found.length) sourceIssues.push({ field: field.id, source: rowKey(junction, link), kind: 'source_orphan_junction' });
          if (found.length > 1) throw new Error(`ambiguous_junction:${field.id}`);
          return found;
        });
      } else throw new Error(`unsupported_relation:${field.id}`);
      if (option.type === 'bt' && sourceRow[child.column.title] != null && targets.length !== 1) {
        if (sourceRow[field.title] !== null) throw new Error(`unresolved_foreign_key:${field.id}`);
        sourceIssues.push({ field: field.id, source: rowKey(table, sourceRow), kind: 'source_orphan_null_link' });
      }
      const reported = sourceRow[field.title];
      if (typeof reported === 'number' && reported !== targets.length) throw new Error(`relation_count_changed:${field.id}`);
      const seen = new Set<string>();
      for (const targetRow of targets) {
        const key = rowKey(target, targetRow);
        if (seen.has(key)) throw new Error(`duplicate_relation:${field.id}`);
        seen.add(key); edges.push({ field: field.id, source: rowKey(table, sourceRow), target: key });
      }
    }
  }
  return edges;
}
