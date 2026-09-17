import fs from 'node:fs/promises';
import path from 'node:path';
import type { Reader, Table, Manifest } from './contracts.mts';
import { inspect } from './inspect.mts';
import { digest } from './json.mts';
import { exportTable } from './export-table.mts';
import { load, save } from './files.mts';
export function schemaHash(tables: Table[]): string {
  return digest(tables.map(t => ({ id: t.id, name: t.table_name, columns: t.columns.map(c => ({
    id: c.id, title: c.title, column_name: c.column_name, uidt: c.uidt, pk: c.pk, ai: c.ai, dt: c.dt, options: c.colOptions
  })).sort((a,b) => a.id.localeCompare(b.id)) })).sort((a,b) => a.id.localeCompare(b.id)));
}
export async function exportSnapshot(reader: Reader, baseId: string, directory: string): Promise<Manifest> {
  const meta = path.join(directory, 'metadata'), data = path.join(directory, 'records');
  await fs.mkdir(data, { recursive: true, mode: 0o700 });
  let tables: Table[];
  try { tables = await load<Table[]>(path.join(meta, 'tables.json')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    tables = await inspect(reader, baseId, meta);
  }
  const manifest: Manifest = { version: 1, baseId, startedAt: new Date().toISOString(), schemaHash: schemaHash(tables),
    tables: [], links: 0, attachments: 0 };
  for (const table of tables) manifest.tables.push(await exportTable(reader, table, data));
  const after = await inspect(reader, baseId, path.join(directory, `metadata-after-${Date.now()}`));
  if (schemaHash(after) !== manifest.schemaHash) throw new Error('source_schema_changed');
  manifest.completedAt = new Date().toISOString();
  await save(path.join(directory, 'rows-manifest.json'), manifest);
  return manifest;
}
