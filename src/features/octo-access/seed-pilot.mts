import { pathToFileURL } from 'node:url';
import { createPostgresClient } from '../../integrations/postgres/working-client.mts';
import type { PostgresTransaction } from '../../integrations/postgres/working-client.mts';
import { createPostgresPool } from '../../integrations/postgres/pg-pool.mts';
import { readPostgresAppDbConfig } from '../../platform/db/postgres/config.mts';
import type { WorkingTable } from '../../integrations/postgres/working-catalog.mts';
import { virtualTypes } from '../../integrations/postgres/working-catalog.mts';
import type { CopyRecord } from '../../integrations/postgres/contracts.mts';

const MARKER = 'octo-pilot-v1';
const fixtures = ['Alex', 'Bob'].map(first => ({ first, key: first.toLowerCase(),
  last: 'OctoTest', name: `${first} OctoTest`,
  email: `${first.toLowerCase()}.octo@example.com`, chat: `octo-test-${first.toLowerCase()}` }));
const proxyFixtures = [{ first:'Test', last:'For Octo Proxy creation', name:'Test For Octo Proxy creation',
  key:'proxy-creation', email:'octo.proxy.test@example.com', chat:'invalid-octo-proxy-fixture-v1' }];
export type SeedGroup = 'pilot' | 'proxy-fixture';
type Read = Pick<PostgresTransaction, 'listRecords'>;
type SeedDb = Read & { listTables(): WorkingTable[]; transaction<T>(op: (tx: PostgresTransaction) => Promise<T>): Promise<T> };
const fail = (code: string): never => { throw new Error(code); };
const norm = (value: unknown) => String(value ?? '').trim().toLowerCase();
async function rows(db: Read, id: string): Promise<CopyRecord[]> {
  const result: CopyRecord[] = []; let after: string[] | undefined;
  do { const page = await db.listRecords(id, { limit: 100, after }); result.push(...page.records); after = page.nextKey ?? undefined; }
  while (after);
  return result;
}

// Only this operator command creates clients. It never creates profiles/accounts or sends messages.
export async function seedPilot(db: SeedDb, apply = false, group: SeedGroup = 'pilot') {
  if (!['pilot','proxy-fixture'].includes(group)) fail('octo_pilot_invalid_arguments');
  const selected = group === 'proxy-fixture' ? proxyFixtures : fixtures;
  const groupMarker = group === 'proxy-fixture' ? 'octo-proxy-fixture-v1' : MARKER;
  const marketName = group === 'proxy-fixture' ? 'en' : 'ru';
  const tables = db.listTables();
  const table = (title: string) => {
    const found = tables.filter(t => t.title === title);
    return found.length === 1 ? found[0] : fail('octo_pilot_catalog_required');
  };
  const clients = table('clients'), stacks = table('stacks'), markets = table('market');
  const physical = (key: string, type: string) => clients.columns.some(c => c.dataKey === key &&
    c.sqlType === type && !virtualTypes.has(c.uidt ?? ''));
  for (const key of ['client_name', 'first_name', 'last_name', 'calendar_email', 'telegram_general_chat_id', 'client_status'])
    if (!physical(key, 'text')) fail('octo_pilot_client_columns_required');
  if (!physical('stacks_id', 'bigint') || !physical('market_id', 'bigint')) fail('octo_pilot_client_columns_required');
  const markerField = physical('legend_info', 'text') ? 'legend_info'
    : physical('nc_row_meta', 'jsonb') ? 'nc_row_meta' : fail('octo_pilot_marker_column_required');
  const marker = (key: string) => `${groupMarker}:${key}`;
  const marked = (row: Record<string, unknown>) => markerField === 'legend_info' ? row.legend_info
    : (row.nc_row_meta as { octoPilotFixture?: unknown } | null)?.octoPilotFixture;
  async function plan(read: Read) {
    const stack = (await rows(read, stacks.id)).filter(r => norm(r.data.name) === 'frontend');
    const market = (await rows(read, markets.id)).filter(r => norm(r.data.market) === marketName);
    if (stack.length !== 1) fail('octo_pilot_frontend_stack_required');
    if (market.length !== 1) fail(group === 'proxy-fixture' ? 'octo_pilot_en_market_required' : 'octo_pilot_ru_market_required');
    const all = await rows(read, clients.id);
    return selected.map(f => {
      const data = { client_name: f.name, first_name: f.first, last_name: f.last,
        calendar_email: f.email, telegram_general_chat_id: f.chat, client_status: 'paused',
        stacks_id: stack[0].data.Id, market_id: market[0].data.Id,
        [markerField]: markerField === 'legend_info' ? marker(f.key) : { octoPilotFixture: marker(f.key) } };
      const matches = all.filter(r => marked(r.data) === marker(f.key) ||
        norm(r.data.calendar_email) === f.email || norm(r.data.telegram_general_chat_id) === f.chat ||
        norm(r.data.client_name) === norm(data.client_name));
      if (matches.length > 1) fail('octo_pilot_fixture_collision');
      const existing = matches[0];
      if (existing && (marked(existing.data) !== marker(f.key) ||
        Object.entries(data).some(([k, value]) => k !== markerField && String(existing.data[k] ?? '') !== String(value))))
        fail('octo_pilot_fixture_collision');
      if (existing && (!Number.isSafeInteger(Number(existing.data.Id)) || Number(existing.data.Id) <= 0))
        fail('octo_pilot_fixture_id_invalid');
      return { first: group === 'proxy-fixture' ? f.name : f.first, data, existing };
    });
  }
  const describe = (p: Awaited<ReturnType<typeof plan>>[number], row = p.existing) =>
    ({ fixture: p.first, clientId: row ? Number(row.data.Id) : null, action: p.existing ? 'existing' : apply ? 'created' : 'would_create' });
  if (!apply) return { mode: 'preview', clients: (await plan(db)).map(p => describe(p)) };
  return db.transaction(async tx => {
    await tx.lockKey(clients.id, groupMarker);
    const planned = await plan(tx), result = [];
    // All collisions are checked before the first insert; any later failure rolls both inserts back.
    for (const p of planned) result.push(describe(p, p.existing ?? await tx.createRecord(clients.id, p.data)));
    return { mode: 'apply', clients: result };
  });
}

export function parseSeedArgs(args: string[]) {
  if (args.some(a => !['--apply', '--dry-run', '--proxy-fixture'].includes(a)) ||
      new Set(args).size !== args.length || args.includes('--apply') && args.includes('--dry-run')) fail('octo_pilot_invalid_arguments');
  return args.includes('--apply');
}
async function main() {
  const args = process.argv.slice(2), apply = parseSeedArgs(args);
  const config = readPostgresAppDbConfig(process.env), pool = createPostgresPool(config);
  try {
    const db = await createPostgresClient(pool, config.database, { writable: apply });
    console.log(JSON.stringify(await seedPilot(db, apply, args.includes('--proxy-fixture') ? 'proxy-fixture' : 'pilot')));
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(/^octo_pilot_[a-z_]+$/.test(error?.message) ? error.message : 'octo_pilot_failed'); process.exitCode = 1; });
