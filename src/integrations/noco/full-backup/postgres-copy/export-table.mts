import fs from 'node:fs/promises';
import path from 'node:path';
import type { Reader, Table, TableExport } from './contracts.mts';
import { primaryKeys } from './contracts.mts';
import { readPages } from './pages.mts';
import { canonical } from './json.mts';
import { selectColumns, checkCoverage } from './columns.mts';
import { hashFile, load, save } from './files.mts';
export async function exportTable(reader: Reader, table: Table, directory: string): Promise<TableExport> {
  const checkpoint = path.join(directory, `${table.id}.complete.json`);
  try {
    const saved = await load<TableExport>(checkpoint);
    if (await hashFile(path.join(directory, saved.file)) !== saved.sha256) throw new Error('checkpoint_checksum_mismatch');
    return saved;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const coverage = await selectColumns(reader, table);
  const file = `${table.id}.${Date.now()}.jsonl`;
  const stream = await fs.open(path.join(directory, file), 'wx', 0o600);
  let count = 0;
  const present = new Set<string>();
  try {
    for await (const page of readPages(reader, `/api/v2/tables/${table.id}/records`,
      primaryKeys(table).map(c => c.title), { fields: coverage.fields })) {
      for (const row of page) {
        checkCoverage(table, coverage, row); Object.keys(row).forEach(key => present.add(key));
        await stream.write(canonical(row) + '\n'); count++;
      }
      await stream.sync();
    }
  } finally { await stream.close(); }
  await save(path.join(directory, `${file}.coverage.json`), { ...coverage, present: [...present],
    unavailable: [...coverage.unavailable, ...coverage.columns.filter(c => count && !present.has(c.title)).map(c => c.id)] });
  const result = { id: table.id, rows: count, file, sha256: await hashFile(path.join(directory, file)) };
  await save(checkpoint, result);
  console.log(JSON.stringify({ table: table.id, rows: count }));
  return result;
}
