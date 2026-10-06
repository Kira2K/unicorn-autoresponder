require('dotenv').config({ quiet: true });
const { resolveStorage } = require('./hh-autoresponses-storage.cjs');
const { createAppDb } = require('../src/platform/db/index.ts');
const { hhReadinessOptions } = require('../src/platform/db/postgres/hh-readiness.mts');
const { closeRuntimePostgresDb } = require('../src/platform/db/postgres/runtime.mts');
const { loadReadinessResults } = require('../src/integrations/noco/hh-response-readiness/index.ts');

async function main() {
  const market = process.argv[2];
  if (!['Ru', 'En'].includes(market)) throw new Error('Expected market Ru or En');
  process.env.APP_DB = resolveStorage();
  try {
    const db = createAppDb();
    const results = await loadReadinessResults({ market, ...hhReadinessOptions(process.env.APP_DB, db) });
    const blocked = results.filter(result => result.problems.length).length;
    console.log(JSON.stringify({ storage: process.env.APP_DB, targets: results.length, ready: results.length - blocked, blocked }));
  } finally { await closeRuntimePostgresDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
