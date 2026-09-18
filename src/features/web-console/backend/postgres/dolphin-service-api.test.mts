import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { linkedInFixture } from './linkedin-fixture.mts';
import { serviceHttpFixture } from './service-http-fixture.mts';
import { createSqlConsoleRepository } from './repository.mts';
import { tableIds as t } from './tables.mts';
import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
const { createDolphinLeaseService, DEFAULT_DOLPHIN_SHARED_USER_EMAIL: email } = createRequire(import.meta.url)('../dolphin-lease.ts');
test('Dolphin lease API selects SQL profiles and passes only them to fake external operations', async () => {
  const f = linkedInFixture(), calls: Array<{ action: string; ids?: number[] }> = [];
  f.rows.get(t.clients)!.get('7')!.last_name = 'Fixture';
  f.set(t.profiles, 33, { clients_id: 7, locale: 'Ru', dolphin_profile_id: '7002' });
  f.set(t.profiles, 32, { clients_id: 8, locale: 'En', dolphin_profile_id: '8001' });
  const service = createDolphinLeaseService({ targetUserId: 5166733, stableUsername: email,
    setTimer: () => undefined, clearTimer() {}, auditLog() {},
    listUsers: async () => [{ id: 5166733, username: email, role: 'user' }],
    updateUser: async () => { calls.push({ action: 'update' }); },
    removeProfileAccess: async (ids: number[]) => { calls.push({ action: 'remove', ids }); },
    shareProfiles: async (ids: number[]) => { calls.push({ action: 'share', ids }); }
  });
  const server = await serviceHttpFixture(createSqlConsoleRepository(f.db, f.grant), { dolphinLeaseService: service });
  try {
    const path = '/api/dolphin/lease/acquire', input = { targetClientId: 7, mode: 'open_existing' };
    assert.equal((await server.request(path, 'POST', input)).status, 401); assert.equal(calls.length, 0);
    await server.login(); f.failRead(true, new PostgresReadError('postgres_read_unavailable'));
    assert.equal((await server.request(path, 'POST', input)).status, 503); assert.equal(calls.length, 0);
    f.failRead(false);
    const response = await server.request(path, 'POST', input);
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual([...body.profileIds].sort(), [7001, 7002]);
    const granted = calls.find(c => c.action === 'share')?.ids; assert.ok(granted);
    assert.deepEqual([...granted].sort(), [7001, 7002]);
    assert.equal(calls.filter(c => c.action === 'update').length, 1);
    assert.equal(f.count(), 0, 'opening an existing profile does not write or provision SQL rows');
  } finally { await server.close(); }
});
