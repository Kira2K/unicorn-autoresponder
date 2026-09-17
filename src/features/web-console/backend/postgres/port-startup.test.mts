import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveConsolePort } from '../reserve-port.mts';

test('occupied port fails before creating services; reserved port responds until the app is ready', async () => {
  const bound = await reserveConsolePort(0, '127.0.0.1');
  const port = (bound.server.address() as { port: number }).port;
  let created = false;
  try {
    await assert.rejects((async () => {
      await reserveConsolePort(port, '127.0.0.1'); created = true;
    })(), { code: 'EADDRINUSE' });
    assert.equal(created, false);
    assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 503);
    bound.attach((_req, res) => { res.end('ready'); });
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'ready');
  } finally { await bound.close(); }
});
