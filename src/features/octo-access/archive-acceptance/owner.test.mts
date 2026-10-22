import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyOnOwner } from './owner.mts';
import { accountDigest, ArchiveFailure, profileIdentity } from './contract.mts';
import { readJson, writeJson } from './files.mts';
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'octo-owner-proof-'));
  const uuid = 'a'.repeat(32), folder = 'b'.repeat(32), email = 'owner@example.test';
  const remote = { uuid, title: 'disposable', description: 'unicorn-octo-archive:run:immediate:Alex',
    folder: 'private', status: 0, has_user_password: false, fingerprint: { os: 'win' }, storage_options: { localstorage: true } };
  const preflight = { schema: 1, id: 'preflight', machine: 'owner-machine', account: accountDigest(email),
    preparedAt: 1000, knownProfiles: [] };
  const request = { schema: 1, id: 'request', runId: 'run', preflightId: 'preflight', sourceMachine: 'client-machine',
    issuedAt: 3000, cycle: 1, operation: 'reopen', profile: { uuid, title: remote.title, description: remote.description,
      folder, createdAt: 2000, identity: profileIdentity(remote) },
    marker: { origin: 'https://example.org', key: 'unicorn-octo-archive', cookie: 'unicorn_octo_archive', value: 'synthetic-only' } };
  const requestPath = join(directory, 'request.request.json'), preflightPath = join(directory, 'preflight.json');
  await writeJson(requestPath, request); await writeJson(preflightPath, preflight);
  const started: Array<string | undefined> = [], cloudPaths: string[] = [];
  const desktop = { async username() { return email; }, async active() { return []; },
    async start(_uuid: string, password?: string) { started.push(password); return 9001; }, async connect() {},
    async matches() { return true; }, async stop() {},
    attempted() { return []; } };
  const api = { async cloudRequest(path: string) { cloudPaths.push(path); return remote; },
    async listFolders() { return [{ uuid: folder, name: 'private' }]; }, async getProfile() { return { ...remote, start_pages: [] }; } };
  const env = { OCTO_ARCHIVE_OWNER_LIVE: '1', OCTO_API_TOKEN: 'never-log-token', OCTO_E2E_OWNER_EMAIL: email };
  return { requestPath, preflightPath, directory, desktop, api, env, started, cloudPaths,
    async verify(seen = false) { return verifyOnOwner({ requestPath, preflightPath }, env,
      { desktop, api, machine: () => 'owner-machine', seenInLogs: async () => seen }); },
    close: () => rm(directory, { recursive: true, force: true }) };
}
test('owner success proves markers and password-free independent restore; replay never starts twice', async () => {
  const f = await fixture();
  try {
    const proof = await f.verify(); assert.equal(proof.passed, true); assert.equal(proof.fresh, true);
    assert.deepEqual(f.started, [undefined]);
    const replay = await f.verify(); assert.equal(replay.passed, false); assert.equal(f.started.length, 1);
    assert.ok(f.cloudPaths.every(p => /^\/profiles\/[a-f0-9]{32}$/.test(p)));
  } finally { await f.close(); }
});
test('cleared cloud metadata cannot pass if the saved archive refuses a password-free start', async () => {
  const f = await fixture();
  try {
    f.desktop.start = async () => { throw Object.assign(new ArchiveFailure('archive_desktop_request_failed'),
      { details: { upstreamCode: 'profiles.password_required', httpStatus: 400, password: 'never-log-password' } }); };
    const proof = await f.verify();
    assert.equal(proof.passed, false); assert.equal(proof.noPassword, false);
    assert.equal(proof.upstreamCode, 'profiles.password_required');
    const saved = await readJson(f.requestPath.replace('.request.json', '.proof.json'));
    assert.ok(!JSON.stringify(saved).includes('never-log'));
    const ledger = await readJson(f.preflightPath + '.ledger.json');
    assert.equal(ledger.profiles['a'.repeat(32)], -1);
  } finally { await f.close(); }
});
test('a previously launched fixture cannot be labelled a fresh restore', async () => {
  const f = await fixture();
  try {
    const proof = await f.verify(true); assert.equal(proof.passed, false);
    assert.equal(proof.error, 'archive_owner_cache_not_fresh'); assert.equal(f.started.length, 0);
  } finally { await f.close(); }
});
test('missing saved markers fails even when metadata and password-free launch succeed', async () => {
  const f = await fixture();
  try {
    f.desktop.matches = async () => false;
    const proof = await f.verify(); assert.equal(proof.passed, false); assert.equal(proof.markers, false);
  } finally { await f.close(); }
});
