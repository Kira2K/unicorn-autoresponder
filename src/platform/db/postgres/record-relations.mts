import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import type { CopyRecord } from '../../../integrations/postgres/contracts.mts';
import type { WorkingTable } from '../../../integrations/postgres/working-catalog.mts';
import type { AppDbRow } from './record-source.mts';

export function appDbRow(record: CopyRecord): AppDbRow {
  const id = Number(record.data.Id);
  if (!Number.isSafeInteger(id) || id <= 0 || record.key.length !== 1 || String(id) !== record.key[0])
    throw new PostgresReadError('appdb_record_id_mismatch');
  return { ...record.data, Id: id };
}

// Materialize the same belongs-to value consumed by the existing Noco repositories.
export async function attachBelongsTo(rows: AppDbRow[], table: WorkingTable, tables: WorkingTable[],
  title: string, targetId: string, readAll: (id: string) => Promise<CopyRecord[]>) {
  const fields = table.columns.filter(c => c.title === title), o = fields[0]?.colOptions;
  const target = tables.find(t => t.id === targetId);
  const child = table.columns.find(c => c.id === o?.fk_child_column_id);
  const parent = target?.columns.find(c => c.id === o?.fk_parent_column_id);
  if (fields.length !== 1 || o?.type !== 'bt' || o.fk_related_model_id !== targetId || !child || !parent || !target)
    throw new PostgresReadError('appdb_relation_required');
  const byKey = new Map((await readAll(targetId)).map(r => [String(r.data[parent.dataKey]), appDbRow(r)]));
  for (const item of rows) {
    const value = item[child.dataKey];
    item[title] = value == null ? null : byKey.get(String(value)) ?? null;
  }
}
