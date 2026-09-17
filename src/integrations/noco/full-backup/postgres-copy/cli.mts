import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createReader } from './reader.mts';
import { inspect } from './inspect.mts';
import { exportSnapshot } from './export.mts';
import { sealSnapshot, openSnapshot } from './snapshot.mts';
import { prepareSql } from './prepare.mts';
import { compareSnapshots } from './reconcile.mts';
import { save, sealArtifacts } from './files.mts';
import { exportDescriptions } from './metadata-extras.mts';
import { auditLinks } from './audit-links.mts';
import { resumePacing } from './pacing.mts';
import { sqlNamesFromInventory } from './sql-mapping.mts';
const [action, envFile, directory] = process.argv.slice(2);
async function main(): Promise<void> {
  if (!action || !envFile || !directory || !path.isAbsolute(directory)) throw new Error('usage_action_env_absolute_artifact_dir');
  const root = path.resolve(import.meta.dirname, '../../../../../..');
  if (!path.relative(root, directory).startsWith('..')) throw new Error('artifacts_must_be_outside_repository');
  if(action==='seal'){await sealArtifacts(directory);return;}
  if (action === 'prepare') {
    const history = [], args = process.argv.slice(5);
    const mappingIndex = args.indexOf('--sql-inventory');
    let inventory: unknown;
    if (mappingIndex >= 0) {
      const file = args[mappingIndex + 1];
      if (!file || !path.isAbsolute(file)) throw new Error('sql_inventory_path_required');
      inventory = JSON.parse(fs.readFileSync(file, 'utf8')); args.splice(mappingIndex, 2);
    }
    for (const dir of args) history.push(await openSnapshot(dir));
    const current = await openSnapshot(directory);
    const names = inventory === undefined ? undefined : sqlNamesFromInventory(inventory, current.tables);
    await prepareSql(current, path.join(directory, 'sql'), history, names);
    if (history.length) await save(path.join(directory, 'comparison.json'), compareSnapshots(history.at(-1)!, current));
    console.log(JSON.stringify({ sqlPrepared: true })); return;
  }
  const env = dotenv.parse(fs.readFileSync(envFile));
  const baseId = env.NOCODB_BASE_ID || 'pqe5susktrsa9z3';
  const token = env.nocodb_api_token || env.NOCODB_API_TOKEN;
  if (!token) throw new Error('missing_noco_token');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const pacing=await resumePacing(path.join(path.dirname(directory),'noco-cooldown.json'));
  const reader = createReader(env.NOCODB_BASE_URL || env.nocodb_base_url || 'https://app.nocodb.com', token,
    event => { pacing(event); fs.appendFileSync(path.join(directory, 'requests.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 }); });
  if (action === 'descriptions') { const s = await openSnapshot(directory);
    await exportDescriptions(reader,s.tables,path.join(directory,'descriptions')); return; }
  if (action === 'audit-links') { await auditLinks(reader,await openSnapshot(directory)); return; }
  if (action === 'export') { await exportSnapshot(reader, baseId, directory); await sealSnapshot(directory); return; }
  if (action !== 'check') throw new Error('unsupported_action');
  const tables = await inspect(reader, baseId, path.join(directory, 'metadata'));
  console.log(JSON.stringify({ tables: tables.length, inventory: tables.map(t => ({ id: t.id,
    columns: t.columns.length, types: [...new Set(t.columns.map(c => c.uidt))] })) }));
}
main().catch(error => { console.error(JSON.stringify({ status: 'blocked', reason:
  error instanceof Error && /^[a-z0-9_:]+$/.test(error.message) ? error.message : 'operation_failed',
  kind: error?.constructor?.name ?? 'Error' })); process.exitCode = 1; });
