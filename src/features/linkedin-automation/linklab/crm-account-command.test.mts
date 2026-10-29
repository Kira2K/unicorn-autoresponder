import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, createHmac} from 'node:crypto';
import {createServer} from 'node:http';
import {accountCommandBody, sendAccountCommand, type AccountCommand} from './crm-account-command.mts';

const secret = 'synthetic-command-key-xxxxxxxxxxxxxxxx';
const student = '10000000-0000-4000-8000-000000000001';
const base: AccountCommand = {
  command: 'ban', event_id: 'cc34899c-a248-4cc0-a2f7-cb79803cffcc',
  client_id: '9223372036854775807', account_id: '21', linklab_version: '8',
  confirmed_at: '2026-10-29T18:00:00Z',
};
const body = accountCommandBody(base);
const options = {baseUrl: 'https://crm.example.test', secret, now: () => 1793296800};
function receipt(bytes: Buffer) {
  const event = JSON.parse(bytes.toString('utf8'));
  const status = event.command === 'ban' ? 'blocked' : 'warmup';
  return {...event, payload_sha256: createHash('sha256').update(bytes).digest('hex'),
    student_id: student, state: 'applied', effects_applied: true, current: true,
    current_linklab_version: event.linklab_version, status, current_status: status,
    ...(status === 'warmup' ? {warmup_started_on: '2026-10-29'} : {})};
}
function response(value: unknown, status = 201) {
  return new Response(JSON.stringify(value), {status});
}

test('ban is a signed command, not a new account cycle; exact bigint is retained', async () => {
  assert.deepEqual(JSON.parse(body.toString()), {schema_version: 1,
    event_type: 'linkedin.account_command', source: 'unicorn', ...base});
  let calls = 0;
  const result = await sendAccountCommand({body, expectedStudentId: student}, {...options,
    fetch: async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://crm.example.test/integrations/linkedin/account-commands/');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.redirect, 'error');
      assert.deepEqual(Buffer.from(init?.body as Uint8Array), body);
      assert.equal((init?.headers as Record<string,string>)['X-CRM-Signature'],
        'v1=' + createHmac('sha256', secret).update('v1:1793296800:').update(body).digest('hex'));
      return response(receipt(body));
    }});
  assert.equal(calls, 1);
  assert.equal(result.studentId, student);
  assert.equal(result.status, 'blocked');
  assert.equal(result.warmupStartedOn, undefined);
});

test('replacement and same-account unban have distinct commands; retry retains bytes', async () => {
  for (const command of ['replacement', 'unban'] as const) {
    const bytes = accountCommandBody({...base, command, cycle_id: '100',
      old_account_id: command === 'unban' ? '21' : '20', account_url: 'https://www.linkedin.com/in/synthetic'});
    const signatures: string[] = [];
    let calls = 0;
    for (const stamp of [1793296800, 1793296850]) {
      const result = await sendAccountCommand({body: bytes, expectedStudentId: student}, {...options,
        now: () => stamp, fetch: async (_url, init) => {
          assert.deepEqual(Buffer.from(init?.body as Uint8Array), bytes);
          signatures.push((init?.headers as Record<string,string>)['X-CRM-Signature']);
          return response(receipt(bytes), ++calls === 1 ? 201 : 200);
        }});
      assert.equal(result.status, 'warmup');
      assert.equal(result.warmupStartedOn, '2026-10-29');
    }
    assert.equal(calls, 2);
    assert.notEqual(signatures[0], signatures[1]);
  }
});

test('bad payload/configuration never causes an HTTP attempt', async () => {
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => {calls++; throw Error('must not send');};
  for (const change of [{client_id: 21}, {client_id: '9223372036854775808'}, {command: 'other'},
    {command: 'unban'}, {command: 'replacement', old_account_id: '21', cycle_id: '2', account_url: 'https://linkedin.com/in/test'},
    {cycle_id: '2'}, {event_id: 'bad'}, {account_id: '0'}]) {
    await assert.rejects(sendAccountCommand({body: Buffer.from(JSON.stringify({
      schema_version: 1, event_type: 'linkedin.account_command', source: 'unicorn', ...base, ...change})),
      expectedStudentId: student}, {...options, fetch}));
  }
  for (const change of [{baseUrl: 'http://crm.example.test'}, {baseUrl: 'https://user:password@crm.example.test'},
    {secret: 'short'}, {now: () => NaN}]) {
    await assert.rejects(sendAccountCommand({body, expectedStudentId: student}, {...options, ...change, fetch}));
  }
  assert.equal(calls, 0);
});

test('wrong, stale or malformed success never counts as confirmation', async () => {
  for (const change of [{current: false}, {student_id: 'another'}, {account_id: '20'},
    {command: 'unban'}, {current_linklab_version: '9'}, {effects_applied: false},
    {payload_sha256: 'other'}, {current_status: 'warmup'}, {event_id: 'another'}]) {
    await assert.rejects(sendAccountCommand({body, expectedStudentId: student}, {...options,
      fetch: async () => response({...receipt(body), ...change})}), /receipt/);
  }
  await assert.rejects(sendAccountCommand({body, expectedStudentId: student}, {...options,
    fetch: async () => new Response('<html>upstream error</html>', {status: 200})}), /receipt/);
});

test('HTTP failures and lost replies make one attempt only and reveal no response/secret', async () => {
  for (const status of [400, 401, 409, 429, 500]) {
    let calls = 0;
    await assert.rejects(sendAccountCommand({body, expectedStudentId: student}, {...options,
      fetch: async () => {calls++; return new Response('private upstream details', {status});}}),
      {message: 'crm_account_command_http_' + status});
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(sendAccountCommand({body, expectedStudentId: student}, {...options,
    fetch: async () => {calls++; throw Error('private upstream details');}}),
    {message: 'crm_account_command_delivery_uncertain'});
  assert.equal(calls, 1);
});

test('actual HTTP transport sends the command and accepts the independently verified signature', async () => {
  let calls = 0;
  const server = createServer(async (request, reply) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const received = Buffer.concat(chunks);
    const signature = 'v1=' + createHmac('sha256', secret)
      .update('v1:' + request.headers['x-crm-timestamp'] + ':').update(received).digest('hex');
    if (request.url !== '/integrations/linkedin/account-commands/' ||
      request.headers['x-crm-signature'] !== signature || !received.equals(body)) {
      reply.writeHead(400).end(); return;
    }
    calls++;
    reply.writeHead(201, {'content-type': 'application/json'}).end(JSON.stringify(receipt(received)));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const result = await sendAccountCommand({body, expectedStudentId: student}, {...options,
      fetch: (url, init) => globalThis.fetch('http://127.0.0.1:' + address.port + new URL(String(url)).pathname, init)});
    assert.equal(result.status, 'blocked');
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
