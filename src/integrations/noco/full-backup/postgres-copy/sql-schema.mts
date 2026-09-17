import type { Snapshot } from './snapshot.mts';
import { canonical } from './json.mts';
import { ident, literal, columnName, tableName, sqlType, type SqlNames } from './sql-values.mts';
export const marker = 'unicorn-noco-copy:pqe5susktrsa9z3:20260911:v1';
export const guard = `DO $$ BEGIN IF current_database() NOT IN ('unicorn_noco_copy','unicorn_noco_copy_restore')
  OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM '${marker}'
  THEN RAISE EXCEPTION 'unowned_target_database'; END IF; END $$;\nSET ROLE unicorn_noco_copy_owner;\nSET standard_conforming_strings=on;\nSET timezone='UTC';\n`;
export function schemaSql(snapshot: Snapshot, names?: SqlNames): string {
  if (snapshot.manifest.baseId !== 'pqe5susktrsa9z3') throw new Error('unexpected_source_base');
  let sql = guard + 'BEGIN; CREATE SCHEMA IF NOT EXISTS noco; CREATE SCHEMA IF NOT EXISTS copy_meta;\n';
  sql += 'CREATE TABLE IF NOT EXISTS copy_meta.inventory (id text PRIMARY KEY, definition jsonb NOT NULL);\n';
  sql += `INSERT INTO copy_meta.inventory VALUES ('schema', ${literal(canonical({ hash: snapshot.manifest.schemaHash }))}::jsonb)
    ON CONFLICT (id) DO NOTHING;\nDO $$ BEGIN IF (SELECT definition->>'hash' FROM copy_meta.inventory WHERE id='schema') <> ${literal(snapshot.manifest.schemaHash)}
    THEN RAISE EXCEPTION 'incompatible_schema'; END IF; END $$;\n`;
  for (const table of snapshot.tables) {
    const physical = tableName(table, names);
    sql += `DO $$ BEGIN IF EXISTS (SELECT FROM copy_meta.inventory WHERE id=${literal(table.id)}
      AND definition->>'sqlTable' IS DISTINCT FROM ${literal('noco.' + physical)})
      THEN RAISE EXCEPTION 'incompatible_sql_table_mapping'; END IF; END $$;\n`;
    const mapping = table.columns.map(c => ({ id: c.id, title: c.title, sqlName: columnName(c, names), sqlType: sqlType(c, names) }));
    sql += `DO $$ BEGIN IF EXISTS (SELECT FROM copy_meta.inventory i,
      jsonb_array_elements(i.definition->'mapping') old,
      jsonb_array_elements(${literal(canonical(mapping))}::jsonb) expected
      WHERE i.id=${literal(table.id)} AND old->>'id'=expected->>'id'
      AND (old->>'sqlName' IS DISTINCT FROM expected->>'sqlName' OR old->>'sqlType' IS DISTINCT FROM expected->>'sqlType'))
      THEN RAISE EXCEPTION 'incompatible_sql_mapping'; END IF; END $$;\n`;
    const columns = table.columns.map(c => `${ident(columnName(c, names))} ${sqlType(c, names)}`).join(',');
    const keys = table.columns.filter(c => c.pk).map(c => ident(columnName(c, names))).join(',');
    sql += `CREATE TABLE IF NOT EXISTS noco.${ident(physical)} (${columns}, _copy_id text UNIQUE NOT NULL, _copy_source jsonb NOT NULL, PRIMARY KEY (${keys}));\n`;
    sql += `INSERT INTO copy_meta.inventory VALUES (${literal(table.id)},${literal(canonical({ ...table,
      sqlTable: `noco.${physical}`, ...(physical !== table.id ? { sqlName: physical } : {}), mapping }))}::jsonb)
      ON CONFLICT (id) DO UPDATE SET definition=EXCLUDED.definition;\n`;
  }
  for (const table of snapshot.tables) for (const field of table.columns.filter(c => ['Links','LinkToAnotherRecord'].includes(c.uidt))) {
    const target = String(field.colOptions?.fk_related_model_id);
    sql += `CREATE TABLE IF NOT EXISTS noco.${ident('link_' + field.id)} (source_id text NOT NULL REFERENCES noco.${ident(tableName(table, names))}(_copy_id)
      DEFERRABLE INITIALLY DEFERRED, target_id text NOT NULL REFERENCES noco.${ident(tableName({ id: target }, names))}(_copy_id) DEFERRABLE INITIALLY DEFERRED, PRIMARY KEY(source_id,target_id));\n`;
  }
  return sql + 'COMMIT;\n';
}
