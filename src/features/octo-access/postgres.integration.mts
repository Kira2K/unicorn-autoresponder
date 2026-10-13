// Explicit opt-in: node --test src/features/octo-access/postgres.integration.mts
// Creates an empty, disposable local container. Never reads application ENV or connects to an existing database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createOctoPostgresStore } from './postgres-store.mts';
import { createPostgresPool } from '../../integrations/postgres/pg-pool.mts';
import { COPY_MARKER } from '../../integrations/postgres/contracts.mts';
import type { SqlPool } from '../../integrations/postgres/contracts.mts';
import type { NewProfile } from './contracts.mts';

const execute = promisify(execFile);
const dockerPath = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
// Force the local Windows daemon; Docker contexts/DOCKER_HOST cannot redirect this fixture remotely.
const docker = (...args: string[]) => execute(dockerPath, ['--host', 'npipe:////./pipe/docker_engine', ...args],
  { timeout: 120_000, maxBuffer: 2_000_000 });
interface PgClient {
  connect(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, any>[] }>;
  end(): Promise<void>;
}
const { Client } = createRequire(import.meta.url)('pg') as { Client: new (config: Record<string, unknown>) => PgClient };
const newProfile = (clientId: number, locale: 'ru' | 'en', password: string): NewProfile => ({
  clientId, locale, password, operationId: randomUUID(), createdAt: Date.now(), ownProxy: false, phase: 'queued',
  original: { title: 'Fixture', description: '', tags: [], start_pages: [] }
});
function catalogDefinition(id: string, name: string, columns: Array<Record<string, unknown>>) {
  return { id, title: name, table_name: name, sqlName: name, sqlTable: `noco.${name}`,
    columns: columns.map(c => ({ ...c })), mapping: columns.map(c => ({ ...c })) };
}

test('isolated PostgreSQL migration rerun and real storage contracts', { timeout: 240_000 }, async t => {
  try { await docker('info', '--format', '{{.ServerVersion}}'); }
  catch { t.skip('Local Docker daemon unavailable; no PostgreSQL fixture was created.'); return; }
  const containerName = `unicorn-octo-fixture-${randomUUID()}`;
  const fixturePassword = randomUUID(), ownerPassword = randomUUID(), appPassword = randomUUID();
  let containerId: string | undefined, admin: PgClient | undefined;
  const pools: SqlPool[] = [];
  const leaders: Array<{ release(): Promise<void> }> = [];
  try {
    const started = await docker('run', '--detach', '--rm', '--name', containerName,
      '--label', 'unicorn.test=octo-postgres', '--publish', '127.0.0.1::5432',
      '--env', `POSTGRES_PASSWORD=${fixturePassword}`, '--env', 'POSTGRES_DB=unicorn_noco_copy_restore', 'postgres:16-alpine');
    containerId = started.stdout.trim();
    assert.match(containerId, /^[a-f0-9]{64}$/);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { await docker('exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'unicorn_noco_copy_restore'); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    assert.equal(ready, true, 'Own PostgreSQL fixture must become ready');
    const published = (await docker('port', containerId, '5432/tcp')).stdout.trim();
    assert.match(published, /^127\.0\.0\.1:\d+$/);
    const port = Number(published.split(':')[1]);
    const connection = { host: '127.0.0.1', port, database: 'unicorn_noco_copy_restore' as const };
    admin = new Client({ ...connection, user: 'postgres', password: fixturePassword }); await admin.connect();
    await admin.query(`COMMENT ON DATABASE unicorn_noco_copy_restore IS '${COPY_MARKER}'`);
    // Passwords are generated fixture UUIDs, never external credentials; use PostgreSQL's own literal quoting.
    const rolePasswords = await admin.query('SELECT quote_literal($1) AS owner_password,quote_literal($2) AS app_password', [ownerPassword, appPassword]);
    await admin.query(`CREATE ROLE unicorn_noco_copy_owner LOGIN PASSWORD ${rolePasswords.rows[0].owner_password}`);
    await admin.query(`CREATE ROLE unicorn_sql_app LOGIN PASSWORD ${rolePasswords.rows[0].app_password}`);
    await admin.query('GRANT CREATE ON DATABASE unicorn_noco_copy_restore TO unicorn_noco_copy_owner');
    await admin.query('SET ROLE unicorn_noco_copy_owner');
    await admin.query(`CREATE SCHEMA noco; CREATE SCHEMA copy_meta;
      CREATE TABLE copy_meta.inventory(id text PRIMARY KEY,definition jsonb NOT NULL);
      CREATE TABLE noco.clients(id bigserial PRIMARY KEY,_copy_id text NOT NULL DEFAULT '[]',_copy_source jsonb NOT NULL DEFAULT '{}');
      CREATE TABLE noco.dolphin_profiles(id bigserial PRIMARY KEY,"02_clients_id" bigint,locale text,dolphin_profile_id text,
        client_name text,created_at timestamptz,updated_at timestamptz,
        _copy_id text NOT NULL DEFAULT '[]' UNIQUE,_copy_source jsonb NOT NULL DEFAULT '{}');
      INSERT INTO noco.clients(id,_copy_id) VALUES(7,'["7"]'),(8,'["8"]');
      INSERT INTO noco.dolphin_profiles(id,"02_clients_id",locale,dolphin_profile_id,_copy_id)
        VALUES(10,7,'Ru','7001','["10"]');
      SELECT setval(pg_get_serial_sequence('noco.dolphin_profiles','id'),10,true);
      GRANT USAGE ON SCHEMA noco,copy_meta TO unicorn_sql_app;
      GRANT SELECT ON copy_meta.inventory TO unicorn_sql_app;
      GRANT SELECT,UPDATE ON noco.clients TO unicorn_sql_app;
      GRANT SELECT,INSERT,UPDATE ON noco.dolphin_profiles TO unicorn_sql_app;
      GRANT USAGE,SELECT ON SEQUENCE noco.dolphin_profiles_id_seq TO unicorn_sql_app;`);
    const clients = catalogDefinition('mxza381054ldlza', 'clients', [{ id: 'client_pk', title: 'Id', sqlName: 'id', sqlType: 'bigint', pk: true }]);
    const profiles = catalogDefinition('m4thvbutfyb15qz', 'dolphin_profiles', [
      { id: 'profile_pk', title: 'Id', sqlName: 'id', sqlType: 'bigint', pk: true },
      { id: 'profile_client', title: 'clients_id', sqlName: '02_clients_id', sqlType: 'bigint', uidt: 'ForeignKey' },
      { id: 'profile_locale', title: 'locale', sqlName: 'locale', sqlType: 'text' },
      { id: 'profile_dolphin', title: 'dolphin_profile_id', sqlName: 'dolphin_profile_id', sqlType: 'text' },
      { id: 'profile_client_relation', title: 'rel_dolphinProfiles_client', sqlName: 'v_client', sqlType: 'jsonb', uidt: 'Links',
        colOptions: { type: 'bt', fk_related_model_id: clients.id, fk_child_column_id: 'profile_client', fk_parent_column_id: 'client_pk' } }
    ]);
    for (const definition of [clients, profiles])
      await admin.query('INSERT INTO copy_meta.inventory(id,definition) VALUES($1,$2::jsonb)', [definition.id, JSON.stringify(definition)]);
    const migration = await readFile(new URL('./sql/001-octo.up.sql', import.meta.url), 'utf8');
    await admin.query(migration); await admin.query(migration); await admin.query('RESET ROLE');
    const legacy = (await admin.query('SELECT browser,dolphin_profile_id,_copy_id FROM noco.dolphin_profiles WHERE id=10')).rows[0];
    assert.deepEqual(legacy, { browser: 'dolphin', dolphin_profile_id: '7001', _copy_id: '["10"]' });
    const config = { ...connection, user: 'unicorn_sql_app', password: appPassword };
    const pool = createPostgresPool(config), lockPool = createPostgresPool(config), competingLocks = createPostgresPool(config);
    pools.push(pool, lockPool, competingLocks);
    const store = createOctoPostgresStore(pool, connection.database, lockPool);
    await store.checkSchema();
    const first = (await store.reserve([newProfile(7,'ru','12345')]))[0]; assert.equal(first.id, 11);
    const pair = await store.reserve([newProfile(7,'ru','54321'),newProfile(7,'en','67890')]);
    assert.deepEqual(pair.map(p => p.id), [first.id,12]);
    await assert.rejects(store.reserve([newProfile(8,'ru','12345')]), { code: 'octo_password_conflict' });
    assert.equal((await store.list(8)).length, 0);
    assert.equal((await admin.query('SELECT count(*)::integer AS n FROM noco.dolphin_profiles')).rows[0].n, 3);
    const saved = await store.save({ ...first, uuid: 'AB-CD', phase: 'ready', proxy: { uuid: 'PX-YZ', title: 'fixture' } });
    assert.equal(saved.revision, 2);
    await assert.rejects(store.save({ ...first, uuid: 'stale' }), { code: 'octo_stale_revision' });
    assert.equal((await store.get(first.id))?.uuid, 'AB-CD');
    await assert.rejects(store.save({ ...pair[1], proxy: { uuid: 'pxyz', title: 'duplicate' } }), { code: 'duplicate_record' });
    assert.equal((await store.get(pair[1].id))?.revision, 1);
    const page = { events: [
      { id: 'stop', profileId: 'AB-CD', action: 'profiles.stopped', time: 30, title: 'masked' },
      { id: 'start', profileId: 'abcd', action: 'profiles.started', time: 20 }
    ], watermark: { uuid: 'page1', time: 30 } };
    await store.recordPage(page); await store.recordPage(page);
    const events = await store.events('Ab-Cd');
    assert.deepEqual(events.map(e => e.id), ['stop','start']); assert.equal(events[0].title, 'masked');
    assert.deepEqual((await store.events('abcd',events[0].seq)).map(e => e.id), ['start']);
    await assert.rejects(store.recordPage({ events: [...page.events,{ ...page.events[0], id: 'new-valid' },{ ...page.events[0], id: 'new', time: Number.NaN }],
      watermark: { uuid: 'failed', time: 50 } }), { code: 'octo_invalid_page' });
    assert.equal((await store.stream()).cursor?.uuid, 'page1'); assert.equal((await store.events('abcd')).length, 2);
    await store.setCoverage(100); await store.setCoverage(50); assert.equal((await store.stream()).coverageSince, 100);
    const leader = await store.leader(); assert.ok(leader); leaders.push(leader); await leader.check();
    const competitor = createOctoPostgresStore(pool, connection.database, competingLocks);
    assert.equal(await competitor.leader(), undefined);
    // A leader retains a session lock without holding a PostgreSQL transaction open.
    const leaderState = await admin.query(`SELECT count(*)::integer AS n FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid
      WHERE l.locktype='advisory' AND a.usename='unicorn_sql_app' AND a.state='idle' AND a.xact_start IS NULL`);
    assert.equal(leaderState.rows[0].n, 1);
    await leader.release(); const nextLeader = await competitor.leader(); assert.ok(nextLeader); leaders.push(nextLeader); await nextLeader.release();
    const lostLeader = await store.leader(); assert.ok(lostLeader); leaders.push(lostLeader);
    const heldPid = await admin.query(`SELECT a.pid FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid
      WHERE l.locktype='advisory' AND a.usename='unicorn_sql_app'`);
    assert.equal(heldPid.rows.length,1);
    await admin.query('SELECT pg_terminate_backend($1)',[heldPid.rows[0].pid]);
    await assert.rejects(lostLeader.check(), { code: 'octo_leadership_lost' });
    await lostLeader.release();
    const [reservationA,reservationB] = await Promise.all([
      store.reserve([newProfile(8,'ru','11111')]),store.reserve([newProfile(8,'ru','22222')])
    ]);
    assert.equal(reservationA[0].id,reservationB[0].id); assert.equal((await store.list(8)).length,1);
    assert.equal((await admin.query('SELECT octo_profile_id FROM noco.dolphin_profiles WHERE id=$1',[first.id])).rows[0].octo_profile_id,'AB-CD');
    const persisted = (await admin.query('SELECT state->>\'password\' AS password FROM noco.octo_profiles WHERE profile_id=$1',[first.id])).rows[0];
    assert.equal(persisted.password,'12345');
  } finally {
    for (const leader of leaders) { try { await leader.release(); } catch {} }
    for (const pool of pools) await pool.end();
    await admin?.end();
    let inspection: any;
    try { inspection = JSON.parse((await docker('inspect',containerId ?? containerName)).stdout)[0]; }
    catch { if (containerId) throw new Error('Own PostgreSQL fixture cleanup failed'); }
    if (inspection) {
      // Never remove a container selected by a broad query/name search.
      if (containerId) assert.equal(inspection.Id,containerId);
      assert.equal(inspection.Name,`/${containerName}`);
      assert.equal(inspection.Config.Labels['unicorn.test'],'octo-postgres');
      await docker('rm','--force',inspection.Id);
    }
  }
});
