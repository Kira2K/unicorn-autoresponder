import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAcceptanceDesktop } from './desktop.mts';
test('password-free owner start omits the password field and never sends cloud credentials locally', async () => {
  const calls: any[] = [];
  const desktop = createAcceptanceDesktop(async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ uuid: 'a'.repeat(32), state: 'STARTED', debug_port: '9001' });
  });
  await desktop.start('a'.repeat(32));
  assert.equal('password' in JSON.parse(calls[0].init.body), false);
  assert.equal(new Headers(calls[0].init.headers).get('X-Octo-Api-Token'), null);
  assert.ok(calls[0].url.startsWith('http://127.0.0.1:58888/'));
});
test('an ambiguous stop cannot be sent twice and an unrelated profile cannot be stopped', async () => {
  let stops = 0;
  const desktop = createAcceptanceDesktop(async (url) => {
    if (String(url).endsWith('/start')) return Response.json({ uuid: 'a'.repeat(32), state: 'STARTED', debug_port: '9001' });
    if (String(url).endsWith('/active')) return Response.json([{ uuid: 'a'.repeat(32) }]);
    if (String(url).endsWith('/stop')) { stops++; throw Error('private transport details'); }
    throw Error('unexpected');
  });
  await assert.rejects(desktop.stop('b'.repeat(32)), { code: 'archive_unscoped_stop' });
  await desktop.start('a'.repeat(32));
  await assert.rejects(desktop.stop('a'.repeat(32)), { code: 'archive_desktop_outcome_unknown' });
  await assert.rejects(desktop.stop('a'.repeat(32)), { code: 'archive_stop_outcome_unknown' });
  assert.equal(stops, 1);
});
