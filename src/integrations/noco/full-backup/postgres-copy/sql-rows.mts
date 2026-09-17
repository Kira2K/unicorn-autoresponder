import type { Row, Table } from './contracts.mts';
import type { Snapshot } from './snapshot.mts';
import { canonical } from './json.mts';
import { rowKey } from './relations.mts';
import { columnName, tableName, ident, sqlType, sqlValue, type SqlNames } from './sql-values.mts';
export function rowColumns(table: Table, names?: SqlNames): string[] {
  return [...table.columns.map(c => columnName(c, names)), '_copy_id', '_copy_source'];
}
export function rowValues(snapshot: Snapshot, table: Table, row: Row, names?: SqlNames): string[] {
  return [...table.columns.map(c => sqlValue(snapshot.unavailable.get(table.id)?.has(c.id) ? undefined : row[c.title], sqlType(c, names))),
    sqlValue(rowKey(table, row), 'text'), sqlValue(row, 'jsonb')];
}
export function insertRow(snapshot: Snapshot, table: Table, row: Row, names?: SqlNames): string {
  const cols = rowColumns(table, names);
  const unavailable = new Set(table.columns.filter(c => snapshot.unavailable.get(table.id)?.has(c.id)).map(c => columnName(c, names)));
  return `INSERT INTO noco.${ident(tableName(table, names))} (${cols.map(ident).join(',')}) VALUES (${rowValues(snapshot, table, row, names).join(',')})
    ON CONFLICT (_copy_id) DO UPDATE SET ${cols.filter(c => c !== '_copy_id' && !unavailable.has(c)).map(c => `${ident(c)}=EXCLUDED.${ident(c)}`).join(',')};\n`;
}
export function verifyRow(snapshot: Snapshot, table: Table, row: Row, names?: SqlNames): string {
  const cols = rowColumns(table, names), vals = rowValues(snapshot, table, row, names);
  const checks = cols.flatMap((c, i) => i < table.columns.length && snapshot.unavailable.get(table.id)?.has(table.columns[i].id)
    ? [] : [`${ident(c)} IS NOT DISTINCT FROM ${vals[i]}`]);
  return `INSERT INTO copy_errors SELECT ${sqlValue(table.id,'text')},${sqlValue(rowKey(table,row),'text')},'value_or_id'
    WHERE NOT EXISTS (SELECT FROM noco.${ident(tableName(table, names))} WHERE ${checks.join(' AND ')});\n`;
}
