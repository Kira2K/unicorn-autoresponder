import fs from 'node:fs/promises';
import path from 'node:path';
import type { Snapshot } from './snapshot.mts';
import { schemaSql, guard } from './sql-schema.mts';
import { insertRow, verifyRow } from './sql-rows.mts';
import { confirmedAbsent } from './reconcile.mts';
import { rowKey } from './relations.mts';
import { ident, literal, columnName, tableName, type SqlNames } from './sql-values.mts';
export async function prepareSql(snapshot: Snapshot, directory: string, history: Snapshot[] = [], names?: SqlNames): Promise<void> {
  const observations=[...history,snapshot].map(s=>s.manifest.completedAt);
  if(observations.some(t=>!t)||new Set(observations).size!==observations.length)throw new Error('repeated_observation_not_evidence');
  if (history.some(s => s.manifest.schemaHash !== snapshot.manifest.schemaHash)) throw new Error('incompatible_source_schema');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const load = await fs.open(path.join(directory, 'import.sql'), 'wx', 0o600);
  const verify = await fs.open(path.join(directory, 'verify.sql'), 'wx', 0o600);
  try {
    await load.write(schemaSql(snapshot, names) + 'BEGIN; SET CONSTRAINTS ALL DEFERRED;\n');
    await verify.write(guard + 'BEGIN; CREATE TEMP TABLE copy_errors(table_id text, record_id text, kind text);\n');
    for (const table of snapshot.tables) {
      const records = snapshot.data.get(table.id)!;
      for (const row of records) { await load.write(insertRow(snapshot, table, row, names)); await verify.write(verifyRow(snapshot,table,row,names)); }
      await verify.write(`INSERT INTO copy_errors SELECT ${literal(table.id)},NULL,'count' WHERE (SELECT count(*) FROM noco.${ident(tableName(table, names))}) <> ${records.length};\n`);
    }
    for (const table of snapshot.tables) for (const field of table.columns.filter(c => ['Links','LinkToAnotherRecord'].includes(c.uidt))) {
      const edges = snapshot.edges.filter(e => e.field === field.id), name = ident('link_' + field.id);
      for (const e of edges) {
        const pair = `source_id=${literal(e.source)} AND target_id=${literal(e.target)}`;
        await load.write(`INSERT INTO noco.${name} VALUES (${literal(e.source)},${literal(e.target)}) ON CONFLICT DO NOTHING;\n`);
        await verify.write(`INSERT INTO copy_errors SELECT ${literal(field.id)},${literal(e.source)},'link' WHERE NOT EXISTS(SELECT FROM noco.${name} WHERE ${pair});\n`);
      }
      const sets = (s: Snapshot) => new Set(s.edges.filter(e => e.field === field.id).map(e => JSON.stringify([e.source,e.target])));
      for (const key of confirmedAbsent(history.map(sets), sets(snapshot))) {
        const [source,target] = JSON.parse(key) as string[];
        await load.write(`DELETE FROM noco.${name} WHERE source_id=${literal(source)} AND target_id=${literal(target)};\n`);
      }
      await verify.write(`INSERT INTO copy_errors SELECT ${literal(field.id)},NULL,'link_count' WHERE (SELECT count(*) FROM noco.${name}) <> ${edges.length};\n`);
    }
    for (const table of snapshot.tables) {
      const physical = ident(tableName(table, names));
      const set = (s: Snapshot) => new Set((s.data.get(table.id)??[]).map(r => rowKey(table,r)));
      for (const id of confirmedAbsent(history.map(set), set(snapshot))) await load.write(`DELETE FROM noco.${physical} WHERE _copy_id=${literal(id)};\n`);
      for (const col of table.columns.filter(c => c.ai)) {
        const seq = `noco.${ident('seq_'+col.id)}`, name = ident(columnName(col, names));
        await load.write(`CREATE SEQUENCE IF NOT EXISTS ${seq}; ALTER SEQUENCE ${seq} OWNED BY noco.${physical}.${name};
          ALTER TABLE noco.${physical} ALTER COLUMN ${name} SET DEFAULT nextval(${literal(seq)}::regclass);
          SELECT setval(${literal(seq)}::regclass,GREATEST(COALESCE((SELECT max(${name}) FROM noco.${physical}),1),(SELECT last_value FROM ${seq})),
            EXISTS(SELECT FROM noco.${physical}) OR (SELECT is_called FROM ${seq}));\n`);
      }
    }
    await load.write('COMMIT;\n');
    await verify.write("SELECT json_build_object('errors',count(*),'details',coalesce(json_agg(copy_errors),'[]'::json)) FROM copy_errors; ROLLBACK;\n");
  } finally { await load.close(); await verify.close(); }
}
