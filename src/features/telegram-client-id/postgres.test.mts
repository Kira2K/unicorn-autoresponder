import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { COPY_MARKER } from '../../integrations/postgres/contracts.mts';
import { createPostgresPool } from '../../integrations/postgres/pg-pool.mts';
import { clientIdStore, clientIdSubscription } from './postgres.mts';
import { createClientIdRuntime, normalizeUsername } from './runtime.mts';

const run = promisify(execFile), bin = process.env.TELEGRAM_ID_TEST_PG_BIN;
const wait = async (condition: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 200; i++) {
    if (await condition()) return;
    await new Promise(r => setTimeout(r, 5));
  }
  assert.fail('operation did not complete');
};

test('real PostgreSQL: raw SQL events, rollback, startup scan, narrow rights and atomic preservation', { skip: !bin }, async () => {
  const root = 'D:/Unicorn/.dev-cache/test-db', artifacts = 'D:/Unicorn/local-artifacts/telegram-client-id-20261106';
  await mkdir(root, { recursive: true }); await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'telegram-client-id-'));
  const probe = net.createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as net.AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  const { Pool } = createRequire(import.meta.url)('pg');
  const options = { host: '127.0.0.1', port, user: 'postgres' };
  let started = false, admin: any, pool: ReturnType<typeof createPostgresPool> | undefined;
  let unsubscribe: (() => Promise<void>) | undefined;
  try {
    await run(path.join(bin!, 'initdb.exe'), ['-D', directory, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'], { windowsHide: true, timeout: 30000 });
    await run(path.join(bin!, 'pg_ctl.exe'), ['-D', directory, '-l', path.join(artifacts, path.basename(directory) + '.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], { windowsHide: true, timeout: 30000 });
    started = true;
    const bootstrap = new Pool({ ...options, database: 'postgres' });
    try { await bootstrap.query('CREATE DATABASE unicorn_noco_copy_restore'); } finally { await bootstrap.end(); }
    admin = new Pool({ ...options, database: 'unicorn_noco_copy_restore' });
    await admin.query(`COMMENT ON DATABASE unicorn_noco_copy_restore IS '${COPY_MARKER}';
      CREATE ROLE unicorn_sql_app LOGIN PASSWORD 'fixture'; CREATE ROLE mathesar_fixture;
      CREATE SCHEMA noco; GRANT USAGE ON SCHEMA noco TO unicorn_sql_app,mathesar_fixture;
      CREATE TABLE noco.clients(id bigint PRIMARY KEY,telegram_personal_chat_id text,client_tg_id text,__nc_deleted boolean,note text DEFAULT 'keep');
      GRANT SELECT,INSERT,UPDATE ON noco.clients TO mathesar_fixture;
      INSERT INTO noco.clients(id,telegram_personal_chat_id) VALUES(1,'@existing_user');`);
    const migration = await readFile(new URL('../../integrations/postgres/telegram-client-id/001-client-id.up.sql', import.meta.url), 'utf8');
    await admin.query(migration); await admin.query(migration);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='noco'")).rows[0].n, 1);
    const config = { ...options, database: 'unicorn_noco_copy_restore' as const, user: 'unicorn_sql_app', password: 'fixture' };
    pool = createPostgresPool(config);
    const store = clientIdStore(pool, config.database), events: string[] = [];
    let lost = 0;
    unsubscribe = await clientIdSubscription(config)(id => events.push(id), () => { lost++; });
    assert.deepEqual(await store.pending('0'), ['1']);

    // NOTIFY must not escape rolled-back writes. A later committed barrier orders the observation.
    const writer = await admin.connect();
    try {
      await writer.query("BEGIN; SET LOCAL ROLE mathesar_fixture; INSERT INTO noco.clients(id,telegram_personal_chat_id) VALUES(2,'@rolled_back'); ROLLBACK");
      await writer.query("SELECT pg_notify('unicorn_client_tg_id','999')");
      await wait(() => events.includes('999')); assert.ok(!events.includes('2'));
      await writer.query("SET ROLE mathesar_fixture; INSERT INTO noco.clients(id,telegram_personal_chat_id) VALUES(3,'@original_user'); RESET ROLE");
      await wait(() => events.includes('3'));
    } finally { writer.release(); }
    const original = (await store.get('3'))!;
    await admin.query("UPDATE noco.clients SET telegram_personal_chat_id='@changed_user' WHERE id=3");
    assert.equal(await store.save(original, '12345'), false);
    const changed = (await store.get('3'))!;
    assert.equal(await store.save(changed, '9007199254740993'), true);
    assert.equal(await store.save(changed, '777'), false);
    await admin.query("UPDATE noco.clients SET telegram_personal_chat_id='@third_user' WHERE id=3");
    assert.equal(await store.get('3'), undefined);
    const record = (await admin.query('SELECT * FROM noco.clients WHERE id=3')).rows[0];
    assert.equal(record.client_tg_id, '9007199254740993'); assert.equal(record.note, 'keep');

    const pending = (await store.get('1'))!;
    await admin.query('UPDATE noco.clients SET __nc_deleted=true WHERE id=1');
    assert.equal(await store.save(pending, '888'), false);
    await admin.query('DELETE FROM noco.clients WHERE id=1');
    assert.equal(await store.save(pending, '888'), false);
    const app = await pool.connect();
    try {
      await app.query('BEGIN READ WRITE');
      await assert.rejects(app.query("UPDATE noco.clients SET note='forbidden' WHERE id=3"));
      await app.query('ROLLBACK');
    } finally { app.release(); }
    await unsubscribe(); unsubscribe = undefined; assert.equal(lost, 0);
    // Complete event -> code -> resolver -> SQL path, using a synthetic Telegram adapter.
    await admin.query("INSERT INTO noco.clients(id,telegram_personal_chat_id) VALUES(4,'@backfill_user'),(5,NULL)");
    // Optional replay of a profile independently read from connected Telegram.
    // It verifies SQL orchestration with real data, NOT the Render/GramJS session.
    const profilePath = process.env.TELEGRAM_ID_VERIFIED_PROFILE;
    const profile = profilePath ? JSON.parse(await readFile(profilePath, 'utf8')) as {
      clientId: string; username: string; userId: string; source: string;
    } : undefined;
    if (profile) {
      assert.match(profile.clientId, /^[1-9]\d*$/); assert.match(profile.userId, /^[1-9]\d*$/);
      assert.ok(normalizeUsername(profile.username)); assert.equal(profile.source, 'connected_telegram_account_status');
    }
    const calls: string[] = [];
    const runtime = createClientIdRuntime({ store, subscribe: clientIdSubscription(config),
      resolve: async username => {
        calls.push(username);
        return profile && username === normalizeUsername(profile.username) ? profile.userId : '555555';
      }, report() {}, spacingMs: 1 });
    try {
      await runtime.start();
      await wait(async () => (await admin.query('SELECT client_tg_id FROM noco.clients WHERE id=4')).rows[0].client_tg_id === '555555');
      await admin.query("UPDATE noco.clients SET telegram_personal_chat_id='@new_username' WHERE id=5");
      await wait(async () => (await admin.query('SELECT client_tg_id FROM noco.clients WHERE id=5')).rows[0].client_tg_id === '555555');
      assert.deepEqual(calls, ['backfill_user','new_username']);
      if (profile) {
        await admin.query('INSERT INTO noco.clients(id,telegram_personal_chat_id) VALUES($1,$2)', [profile.clientId,profile.username]);
        await wait(async () => (await admin.query('SELECT client_tg_id FROM noco.clients WHERE id=$1', [profile.clientId])).rows[0].client_tg_id === profile.userId);
        assert.equal(calls.at(-1), normalizeUsername(profile.username));
        console.log('Verified profile replay into LOCAL PostgreSQL:', profile.username, '->', profile.userId);
      }
    } finally { await runtime.stop(); }
    await admin.query(await readFile(new URL('../../integrations/postgres/telegram-client-id/001-client-id.down.sql', import.meta.url), 'utf8'));
    assert.equal((await admin.query('SELECT client_tg_id FROM noco.clients WHERE id=3')).rows[0].client_tg_id, '9007199254740993');
  } finally {
    await unsubscribe?.(); await pool?.end(); await admin?.end();
    if (started) await run(path.join(bin!, 'pg_ctl.exe'), ['-D', directory, '-m', 'immediate', '-w', 'stop'], { windowsHide: true, timeout: 15000 });
    const resolved = await realpath(directory), expected = await realpath(root);
    assert.ok(resolved.toLowerCase().startsWith(expected.toLowerCase() + path.sep));
    await rm(resolved, { recursive: true, force: true });
  }
});
