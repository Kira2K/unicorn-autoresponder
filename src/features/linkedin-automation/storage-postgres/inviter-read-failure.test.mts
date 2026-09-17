import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import { createReadSession } from '../../../integrations/postgres/read-session.mts';
import { featureFixture } from './fixture.mts';
import { createSqlInviterStore } from './inviter-store.mts';
import { fixture } from '../connection-inviter/tests/fixtures.ts';
import { createConnectionInviterService } from '../connection-inviter/service.ts';
import { connectionErrorCode, transientConnectionError } from '../connection-inviter/errors.ts';

test('Inviter restores after SQL read outage; the real read boundary keeps credentials private', async () => {
  const f = featureFixture(), p = fixture({ stack: 'Frontend' });
  f.grant.accountIds = new Set([7]);
  let reads = 0;
  const find = f.db.findRecords;
  f.db.findRecords = async (...args) => {
    if (++reads === 1) return createReadSession({ async end() {}, async connect() {
      throw Object.assign(Error('SECRET connection value'), { code: 'ECONNREFUSED' });
    } }, 'unicorn_noco_copy')(async () => ({ records: [], nextKey: null }));
    return find(...args);
  };
  const service = createConnectionInviterService({ ...p, store: createSqlInviterStore(f.db, f.grant),
    autoRecover: true, sleep: async () => {} });
  try {
    for (let i = 0; i < 100 && reads < 2; i++) await setImmediate();
    assert.equal(reads, 2); assert.equal(p.metrics.sends, 0);
    assert.equal(f.calls.filter(c => c === 'create').length, 0);
  } finally { service.stop(); }
});

test('Stop ends SQL recovery wait without another read or invitation', async () => {
  const f = featureFixture(), p = fixture({ stack: 'Frontend' }); let reads = 0, waits = 0;
  f.db.findRecords = async () => { reads++; throw new PostgresReadError('postgres_read_unavailable'); };
  const service = createConnectionInviterService({ ...p, store: createSqlInviterStore(f.db, f.grant),
    autoRecover: true, sleep: async () => { waits++; service.stop(); } });
  try {
    for (let i = 0; i < 100 && !waits; i++) await setImmediate();
    assert.equal(waits, 1); assert.equal(reads, 1); assert.equal(p.metrics.sends, 0);
  } finally { service.stop(); }
});

test('only the explicit temporary-read code authorizes recovery, never writes or unknown errors', () => {
  assert.equal(connectionErrorCode(new PostgresReadError('postgres_read_unavailable')), 'connection_storage_read_unavailable');
  assert.equal(transientConnectionError(new PostgresReadError('postgres_read_unavailable')), true);
  for (const code of ['commit_uncertain', 'postgres_write_failed', 'postgres_read_failed', 'database_not_allowed'])
    assert.equal(transientConnectionError(new PostgresReadError(code)), false, code);
  assert.equal(transientConnectionError({ code: 'noco_unreachable' }), true);
  assert.equal(transientConnectionError({ code: 'unipile_rate_limit' }), true);
});
