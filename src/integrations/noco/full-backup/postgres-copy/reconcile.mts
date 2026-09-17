import type { Snapshot } from './snapshot.mts';
import { canonical, digest } from './json.mts';
import { rowKey } from './relations.mts';
export function confirmedAbsent(history: Set<string>[], current: Set<string>): string[] {
  if (!history.length) return [];
  const previous = history.at(-1)!;
  return [...new Set(history.flatMap(s => [...s]))].filter(id => !previous.has(id) && !current.has(id));
}
export function compareSnapshots(before: Snapshot, after: Snapshot) {
  if (before.manifest.schemaHash !== after.manifest.schemaHash) throw new Error('incompatible_source_schema');
  const differences: { table: string; id: string; change: string }[] = [];
  for (const table of after.tables) {
    const a = new Map((before.data.get(table.id) ?? []).map(r => [rowKey(table, r), digest(r)]));
    const b = new Map((after.data.get(table.id) ?? []).map(r => [rowKey(table, r), digest(r)]));
    for (const [id, hash] of b) if (a.get(id) !== hash) differences.push({ table: table.id, id, change: a.has(id) ? 'changed' : 'added' });
    for (const id of a.keys()) if (!b.has(id)) differences.push({ table: table.id, id, change: 'absent' });
  }
  const a = new Set(before.edges.map(canonical)), b = new Set(after.edges.map(canonical));
  return { rows: differences, linksAdded: [...b].filter(k => !a.has(k)), linksAbsent: [...a].filter(k => !b.has(k)) };
}
