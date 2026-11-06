import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramIdResolver, classifyLookupError } from './resolver.mts';
import { normalizeUsername } from './runtime.mts';

test('normalization accepts @username, bare username and t.me link; rejects unrelated links and chat invites', () => {
  for (const value of [' @Alice_Test ', 'alice_test', 'https://t.me/Alice_Test/', 't.me/alice_test'])
    assert.equal(normalizeUsername(value), 'alice_test');
  for (const value of ['', '12345', '@ab', 'https://example.com/alice_test', 't.me/+invite', 'alice_test/12'])
    assert.equal(normalizeUsername(value), undefined);
});

test('RPC result must refer to a real human; ID remains exact text and one client is reused', async () => {
  let opens = 0, closes = 0;
  const client = { invoke: async () => {}, disconnect: async () => { closes++; } };
  const answer = { peer: { className: 'PeerUser', userId: 9007199254740993n }, users: [{ className: 'User', id: 9007199254740993n }] };
  let result: any = answer;
  const resolver = createTelegramIdResolver({ open: async () => { opens++; return client; }, lookup: async () => result });
  try {
    assert.equal(await resolver.resolve('alice_test'), '9007199254740993');
    assert.equal(await resolver.resolve('alice_test'), '9007199254740993'); assert.equal(opens, 1);
    for (const other of [
      { peer: { className: 'PeerChannel', channelId: 42n }, users: [] },
      { ...answer, users: [{ className: 'User', id: 9007199254740993n, bot: true }] },
      { ...answer, users: [{ className: 'User', id: 9007199254740993n, deleted: true }] },
      { ...answer, users: [{ className: 'UserEmpty', id: 9007199254740993n }] },
      { ...answer, users: [{ className: 'User', id: 1n }] }
    ]) { result = other; await assert.rejects(resolver.resolve('alice_test'), { code: 'not_user' }); }
  } finally { await resolver.close(); }
  assert.equal(closes, 1);
});

test('not found, invalid input and required flood wait are classified without provider text leakage', () => {
  assert.deepEqual(classifyLookupError({ errorMessage: 'USERNAME_NOT_OCCUPIED' }), { code: 'not_found' });
  assert.deepEqual(classifyLookupError({ errorMessage: 'USERNAME_INVALID' }), { code: 'invalid_username' });
  assert.deepEqual(classifyLookupError({ code: 'telegram_session_required' }), { code: 'session_required' });
  assert.deepEqual(classifyLookupError({ errorMessage: 'AUTH_KEY_UNREGISTERED' }), { code: 'session_required' });
  assert.deepEqual(classifyLookupError(Error('lookup_timeout')), { code: 'timeout' });
  assert.deepEqual(classifyLookupError({ errorMessage: 'FLOOD_WAIT_37' }), { code: 'temporary', retryAfterMs: 37000 });
  assert.deepEqual(classifyLookupError({ seconds: 12 }), { code: 'temporary', retryAfterMs: 12000 });
  assert.deepEqual(classifyLookupError(Error('private-secret')), { code: 'temporary', retryAfterMs: 0 });
});

test('timed-out authorization that completes late is disconnected and never used', async () => {
  let open!: (client: any) => void, closed = 0, lookups = 0;
  const resolver = createTelegramIdResolver({ open: () => new Promise(r => { open = r; }),
    lookup: async () => { lookups++; } }, 5);
  await assert.rejects(resolver.resolve('alice_test'), { code: 'timeout' });
  open({ disconnect: async () => { closed++; } });
  await new Promise(r => setTimeout(r, 1));
  assert.equal(closed, 1); assert.equal(lookups, 0); await resolver.close();
});
