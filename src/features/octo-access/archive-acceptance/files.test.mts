import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileOwnerVerifier, writeJson } from './files.mts';
import { requestDigest } from './contract.mts';
import type { OwnerProof, OwnerRequest } from './contract.mts';
test('file handoff binds one fresh-owner proof and keeps failed archive evidence sanitized', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'octo-handoff-'));
  try {
    const preflightPath = join(directory, 'preflight.json');
    await writeJson(preflightPath, { schema: 1, id: 'preflight', machine: 'owner-machine', account: 'owner-account',
      preparedAt: 1000, knownProfiles: [] });
    let observed: OwnerProof | undefined;
    const verifier = await createFileOwnerVerifier({ preflightPath, directory, runId: 'run', sourceMachine: 'guest-machine',
      onProof: proof => { observed = proof; }, onRequest: path => {
        const request: OwnerRequest = JSON.parse(readFileSync(path, 'utf8'));
        writeFileSync(path.replace('.request.json', '.proof.json'), JSON.stringify({ schema: 1,
          requestId: request.id, digest: requestDigest(request), machine: 'owner-machine', account: 'owner-account',
          uuid: request.profile.uuid, cycle: 1, startedAt: request.issuedAt, finishedAt: request.issuedAt + 1,
          fresh: true, passed: false, noPassword: false, markers: false, identity: true, stopped: true,
          error: 'archive_desktop_request_failed', archiveErrors: ['ProfileRequiresUserPasswordError'],
          token: 'private-token' }));
      } });
    await assert.rejects(verifier.verify({ uuid: 'a'.repeat(32), title: 'fixture',
      description: 'unicorn-octo-archive:run:immediate:Alex', folder: 'b'.repeat(32), createdAt: 2000, identity: 'c'.repeat(64) },
    { origin: 'https://example.org', key: 'unicorn-octo-archive', cookie: 'unicorn_octo_archive', value: 'synthetic' }, 1),
    { code: 'archive_owner_restore_failed' });
    assert.deepEqual(observed?.archiveErrors, ['ProfileRequiresUserPasswordError']);
    assert.ok(!JSON.stringify(observed).includes('private-token'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('a same-PC preflight is refused before issuing any owner request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'octo-handoff-'));
  try {
    const preflightPath = join(directory, 'preflight.json');
    await writeJson(preflightPath, { schema: 1, id: 'preflight', machine: 'same', account: 'owner', preparedAt: 1, knownProfiles: [] });
    await assert.rejects(createFileOwnerVerifier({ preflightPath, directory, runId: 'run', sourceMachine: 'same',
      onRequest() { assert.fail('must not issue a request'); } }), { code: 'archive_independent_owner_required' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
