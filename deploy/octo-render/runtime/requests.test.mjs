import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrainingFetch } from './requests.mjs';
import { createAgent } from '../bridge/agent.mjs';
const backend = 'https://backend.example.com';
const abortableBody = signal => new Promise((resolve, reject) => {
  signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
  if (signal.aborted) reject(Error('aborted'));
});
test('stopping refuses new polls/authorization/local calls but permits bounded result acknowledgements', async () => {
  const calls = [], network = createDrainingFetch(backend, async (url) => { calls.push(String(url)); return Response.json({ accepted: true }); });
  try {
    network.stop();
    for (const url of [backend + '/internal/octo-bridge/v1/poll', backend + '/internal/octo-bridge/v1/authorize',
      'http://127.0.0.1:58888/api/profiles/password'])
      await assert.rejects(network.fetch(url, { method: 'POST' }), { code: 'bridge_render_stopping' });
    const ack = await network.fetch(backend + '/internal/octo-bridge/v1/result', { method: 'POST' }); await ack.json();
    assert.equal(calls.length, 1);
  } finally { network.dispose(); }
});
test('shutdown aborts a stalled body after headers, persists uncertainty and never repeats DELETE after restart', async () => {
  const uuid = 'a'.repeat(32), id = 'grant-one';
  const config = { backendUrl: backend, bridgeId: 'owner', secret: 's'.repeat(43), ownerEmail: 'owner@example.com',
    allowedProfileUuids: [uuid], pollMilliseconds: 1000 };
  const journal = { data: { deviceId: 'b'.repeat(64), entries: {} }, async save() {} };
  const task = { version: 1, bridgeId: 'owner', id, uuid, password: '03742', ownerEmail: config.ownerEmail, expiresAt: 1, hiddenAt: 2 };
  let deletes = 0, acked = false, dispatched;
  const sent = new Promise(resolve => { dispatched = resolve; });
  const mock = async (url, init) => {
    url = String(url);
    if (url.endsWith('/username')) return Response.json({ username: config.ownerEmail });
    if (url.endsWith('/active')) return Response.json([]);
    if (url.endsWith('/poll')) return Response.json({ task: acked ? null : task });
    if (url.endsWith('/authorize')) return Response.json({ authorized: true });
    if (url.endsWith('/password')) {
      deletes++; dispatched();
      return { ok: true, status: 200, json: () => abortableBody(init.signal) };
    }
    if (url.endsWith('/result')) { acked = true; return Response.json({ accepted: true }); }
    throw Error('unexpected request');
  };
  const network = createDrainingFetch(backend, mock, { graceMs: 10, ackMs: 20 });
  try {
    const work = createAgent({ config, journal, fetchImpl: network.fetch, now: () => 100 }).step();
    await sent; network.stop(); await work;
    assert.equal(journal.data.entries[id].result.state, 'uncertain'); assert.equal(deletes, 1);
    await createAgent({ config, journal, fetchImpl: mock, now: () => 100 }).step();
    assert.equal(deletes, 1); assert.ok(!JSON.stringify(journal.data).includes('03742'));
  } finally { network.dispose(); }
});
test('an acknowledgement already in flight is bounded as well', async () => {
  const network = createDrainingFetch(backend, async (_, init) => ({ ok: true, status: 200,
    json: () => abortableBody(init.signal) }), { graceMs: 10 });
  try {
    const response = await network.fetch(backend + '/internal/octo-bridge/v1/result', { method: 'POST' });
    const body = response.json(); network.stop(); await assert.rejects(body);
  } finally { network.dispose(); }
});
