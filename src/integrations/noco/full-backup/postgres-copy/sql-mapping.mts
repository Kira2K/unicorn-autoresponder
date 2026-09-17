import type { Table } from './contracts.mts';
import { columnName, sqlType, type SqlNames } from './sql-values.mts';
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_sql_mapping');
  return value as Record<string, unknown>;
}
/** Only operator-supplied SQL inventory can override physical names; source metadata stays unchanged. */
export function sqlNamesFromInventory(input: unknown, tables: readonly Table[]): SqlNames {
  if (!Array.isArray(input)) throw new Error('invalid_sql_mapping');
  const rows = input.map(record), names = Object.assign(new Map<string, string>(), { types: new Map<string, string>() }), physicalNames = new Set<string>();
  for (const table of tables) {
    const candidates = rows.filter(row => row.id === table.id);
    if (candidates.length > 1) throw new Error('invalid_sql_mapping');
    if (!candidates.length) continue;
    const definition = record(candidates[0].definition);
    const physical = definition.sqlName ?? table.id;
    if (typeof physical !== 'string' || !physical || physical.includes('\0') || Buffer.byteLength(physical) > 63 ||
        physicalNames.has(physical) || definition.id !== table.id || definition.sqlTable !== `noco.${physical}` ||
        !Array.isArray(definition.mapping))
      throw new Error('invalid_sql_mapping');
    physicalNames.add(physical);
    names.set(table.id, physical);
    const mapping = definition.mapping.map(record);
    if (new Set(mapping.map(m => m.id)).size !== mapping.length) throw new Error('invalid_sql_mapping');
    for (const column of table.columns) {
      const item = mapping.find(m => m.id === column.id);
      if (!item) continue; // A newly added source field has no previous physical mapping.
      const textSelect = column.uidt === 'MultiSelect' && item.sqlType === 'text';
      if ((!textSelect && item.sqlType !== sqlType(column)) || typeof item.sqlName !== 'string' || !item.sqlName ||
          item.sqlName.includes('\0') || item.sqlName.startsWith('_copy_') || names.has(column.id))
        throw new Error('invalid_sql_mapping');
      names.set(column.id, item.sqlName);
      if (textSelect) names.types.set(column.id, 'text');
    }
    if (new Set(table.columns.map(c => columnName(c, names))).size !== table.columns.length)
      throw new Error('invalid_sql_mapping');
  }
  return names;
}
