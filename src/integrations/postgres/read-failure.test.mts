import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COPY_MARKER, PostgresReadError, type SqlPool } from './contracts.mts';
import { createReadSession } from './read-session.mts';
import { writeTransaction } from './working-session.mts';

function failingPool(code: string | undefined, stage = 'SELECT fixture', message = 'SECRET SQL row and connection data') {
  const calls: string[] = [], releases: boolean[] = [];
  const failure = Object.assign(Error(message), code === undefined ? {} : { code });
  const pool: SqlPool = { async end() {}, async connect() {
    calls.push('connect'); if (stage === 'connect') throw failure;
    return { release(destroy) { releases.push(Boolean(destroy)); }, async query(sql) {
      calls.push(sql); if (sql === stage) throw failure;
      return { rows: sql.includes('current_database()') ? [{ database: 'unicorn_noco_copy', marker: COPY_MARKER }] : [] };
    } };
  } };
  return { pool, calls, releases };
}

test('only known transient read failures are retryable; SQL client never retries itself', async () => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', '08006', '57P01', '53300', '57014', '40001', '40P01', '42601', '42501', '28P01', 'unknown']) {
    const f = failingPool(code);
    const expected = ['42601', '42501', '28P01', 'unknown'].includes(code) ? 'postgres_read_failed' : 'postgres_read_unavailable';
    await assert.rejects(createReadSession(f.pool, 'unicorn_noco_copy')(s => s.query('SELECT fixture')), error => {
      assert(error instanceof PostgresReadError); assert.equal(error.code, expected);
      assert.equal(error.message, expected); assert.equal('cause' in error, false); return true;
    });
    assert.equal(f.calls.filter(c => c === 'SELECT fixture').length, 1);
    assert.equal(f.calls.at(-1), 'ROLLBACK'); assert.deepEqual(f.releases, [true]);
  }
});

test('pg 8.23 driver timeouts without SQLSTATE are read outages, not generic message matching', async () => {
  for (const message of ['Query read timeout', 'Connection terminated unexpectedly', 'timeout expired',
    'timeout exceeded when trying to connect', 'Connection terminated due to connection timeout']) {
    const f = failingPool(undefined, 'SELECT fixture', message);
    await assert.rejects(createReadSession(f.pool, 'unicorn_noco_copy')(s => s.query('SELECT fixture')),
      { code: 'postgres_read_unavailable' });
    assert.equal(f.calls.filter(c => c === 'SELECT fixture').length, 1);
    const write = failingPool(undefined, 'COMMIT', message);
    await assert.rejects(writeTransaction(write.pool, 'unicorn_noco_copy', async () => {}), { code: 'commit_uncertain' });
  }
  for (const [code, message] of [[undefined, 'custom timeout'], ['42501', 'Query read timeout'],
    [undefined, 'Cannot use a pool after calling end on the pool']] as const) {
    const f = failingPool(code, 'connect', message);
    await assert.rejects(createReadSession(f.pool, 'unicorn_noco_copy')(async () => {}), { code: 'postgres_read_failed' });
  }
});

test('connection failure is a read outage, but writes and uncertain COMMIT are never classified as reads', async () => {
  const read = failingPool('ECONNREFUSED', 'connect');
  await assert.rejects(createReadSession(read.pool, 'unicorn_noco_copy')(async () => {}), { code: 'postgres_read_unavailable' });
  assert.deepEqual(read.calls, ['connect']);
  for (const stage of ['connect', 'SELECT fixture', 'COMMIT']) {
    const f = failingPool('ECONNRESET', stage);
    await assert.rejects(writeTransaction(f.pool, 'unicorn_noco_copy', s => s.query('SELECT fixture')),
      { code: stage === 'COMMIT' ? 'commit_uncertain' : 'postgres_write_failed' });
    assert.equal(f.calls.filter(c => c === 'connect').length, 1);
  }
});
