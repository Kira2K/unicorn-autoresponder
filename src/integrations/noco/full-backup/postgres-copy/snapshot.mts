import path from 'node:path';
import type { Manifest, Row, Table } from './contracts.mts';
import { hashFile, load, rows, save } from './files.mts';
import { buildRelations } from './relations.mts';
export async function openSnapshot(directory: string) {
  const manifest = await load<Manifest>(path.join(directory, 'rows-manifest.json'));
  if (!manifest.completedAt) throw new Error('incomplete_snapshot');
  const tables = await load<Table[]>(path.join(directory, 'metadata', 'tables.json'));
  const data = new Map<string, Row[]>();
  const unavailable = new Map<string, Set<string>>();
  for (const table of tables) {
    const entry = manifest.tables.find(t => t.id === table.id);
    if (!entry || await hashFile(path.join(directory, 'records', entry.file)) !== entry.sha256) throw new Error('snapshot_checksum_failed');
    const records: Row[] = [];
    for await (const row of rows(path.join(directory, 'records', entry.file))) records.push(row);
    if (records.length !== entry.rows) throw new Error('snapshot_count_failed');
    data.set(table.id, records);
    const coverage = await load<{ unavailable: string[] }>(path.join(directory, 'records', entry.file + '.coverage.json'));
    unavailable.set(table.id, new Set(coverage.unavailable));
  }
  const sourceIssues: { field: string; source: string; kind: string }[] = [];
  const edges = buildRelations(tables, data, sourceIssues);
  return { manifest, tables, data, edges, sourceIssues, unavailable, directory };
}
export type Snapshot = Awaited<ReturnType<typeof openSnapshot>>;
export async function sealSnapshot(directory: string): Promise<void> {
  const snapshot = await openSnapshot(directory);
  if (snapshot.tables.some(t => t.columns.some(c => c.uidt === 'Attachment'))) throw new Error('attachments_require_download');
  await save(path.join(directory, 'relations.json'), snapshot.edges);
  await save(path.join(directory, 'source-issues.json'), snapshot.sourceIssues);
  await save(path.join(directory, 'manifest.json'), { ...snapshot.manifest, links: snapshot.edges.length,
    relationSha256: await hashFile(path.join(directory, 'relations.json')), attachments: 0 });
  console.log(JSON.stringify({ tables: snapshot.tables.length, rows: [...snapshot.data.values()].reduce((n,r) => n+r.length,0),
    directedLinks: snapshot.edges.length, attachments: 0 }));
}
