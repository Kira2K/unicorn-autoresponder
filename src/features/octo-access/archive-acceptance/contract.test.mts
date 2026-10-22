import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptOwnerProof, requestDigest, assertNewFixture, parseProof, parseRequest, failureFields, readFixtureEmails } from './contract.mts';
import type { OwnerRequest, OwnerProof, OwnerPreflight } from './contract.mts';
const preflight: OwnerPreflight = { schema: 1, id: 'preflight', machine: 'owner-machine', account: 'owner-account',
  preparedAt: 1000, knownProfiles: ['existing'] };
const request: OwnerRequest = { schema: 1, id: 'request', runId: 'run', sourceMachine: 'client-machine',
  preflightId: 'preflight', issuedAt: 3000, cycle: 1, operation: 'reopen',
  profile: { uuid: 'a'.repeat(32), title: 'fixture', description: 'unicorn-octo-archive:run:immediate:Alex',
    folder: 'b'.repeat(32), createdAt: 2000, identity: 'c'.repeat(64) },
  marker: { origin: 'https://example.org', key: 'unicorn-octo-archive', value: 'cycle-one', cookie: 'unicorn_octo_archive' } };
function proof(): OwnerProof { return { schema: 1, requestId: request.id, digest: requestDigest(request),
  machine: preflight.machine, account: preflight.account, uuid: request.profile.uuid, cycle: 1,
  startedAt: 3100, finishedAt: 3200, fresh: true, passed: true, noPassword: true,
  markers: true, identity: true, stopped: true }; }
test('owner proof requires independent owner machine, fresh first restore and exact request', () => {
  acceptOwnerProof(request, proof(), preflight);
  for (const patch of [{ machine: request.sourceMachine }, { account: 'guest' }, { digest: 'stale' },
    { uuid: 'other' }, { cycle: 2 }, { fresh: false }, { noPassword: false }, { markers: false },
    { identity: false }, { stopped: false }, { passed: false }, { startedAt: 2999 }, { finishedAt: 3001 }]) {
    assert.throws(() => acceptOwnerProof(request, { ...proof(), ...patch }, preflight));
  }
});
test('later cycles still require a new saved marker and a current password-free restore', () => {
  const next = { ...request, cycle: 2, marker: { ...request.marker!, value: 'cycle-two' } };
  assert.notEqual(requestDigest(next), requestDigest(request));
  acceptOwnerProof(next, { ...proof(), cycle: 2, fresh: false, digest: requestDigest(next) }, preflight);
  assert.throws(() => acceptOwnerProof(next, proof(), preflight));
});
test('existing profiles and preflight taken after creation cannot become disposable fixtures', () => {
  assertNewFixture(request, preflight);
  assert.throws(() => assertNewFixture(request, { ...preflight, knownProfiles: [request.profile.uuid] }));
  assert.throws(() => assertNewFixture(request, { ...preflight, preparedAt: 2001 }));
  assert.throws(() => assertNewFixture({ ...request, sourceMachine: preflight.machine }, preflight));
  assert.throws(() => assertNewFixture({ ...request, preflightId: 'other' }, preflight));
});
test('support evidence excludes arbitrary fields, raw provider errors and unknown archive messages', () => {
  const safe = parseProof({ ...proof(), error: 'archive_owner_restore_failed', password: 'private-password',
    token: 'private-token', archiveErrors: ['ProfileRequiresUserPasswordError', 'private-stack'],
    upstreamCode: 'profiles.password_required', rawResponse: { password: 'private-password' } });
  assert.deepEqual(safe.archiveErrors, ['ProfileRequiresUserPasswordError']);
  assert.ok(!JSON.stringify(safe).includes('private'));
  assert.deepEqual(failureFields(Error('private password echoed')), { error: 'archive_operation_failed' });
});
test('owner acceptance requires saved markers and only reopens; it cannot mutate passwords', () => {
  parseRequest(request);
  assert.throws(() => parseRequest({ ...request, marker: undefined }), { code: 'archive_saved_marker_required' });
  assert.throws(() => parseRequest({ ...request, operation: 'local-clear' }), { code: 'archive_request_invalid' });
  assert.throws(() => parseRequest({ ...request, marker: undefined, profile: { ...request.profile,
    description: 'unicorn-octo-archive:run:unopened:Alex' } }), { code: 'archive_saved_marker_required' });
});
test('new Console fixtures use reserved synthetic emails and validate both owners before any writes', () => {
  assert.deepEqual(readFixtureEmails({}), { Alex: 'alex.octo@example.com', Bob: 'bob.octo@example.com' });
  assert.equal(readFixtureEmails({ OCTO_E2E_ALEX_EMAIL: 'alex.octo.run-22@example.com' }).Alex, 'alex.octo.run-22@example.com');
  for (const email of ['client@gmail.com', 'alex.octo@example.com.attacker.test', 'bob.octo@example.com']) {
    assert.throws(() => readFixtureEmails({ OCTO_E2E_ALEX_EMAIL: email }), { code: 'archive_synthetic_fixture_email_required' });
  }
  assert.throws(() => readFixtureEmails({ OCTO_E2E_BOB_EMAIL: 'actual-client@example.com' }),
    { code: 'archive_synthetic_fixture_email_required' });
});
