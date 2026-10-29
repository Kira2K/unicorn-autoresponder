import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliverSuccessfulReport, fileDeliveryStore } from './delivery.mts';
import type { CycleJournal } from './journal.mts';

const journal: CycleJournal = { runId: 'fixture-run', createdAt: '', passed: true, manualClientId: 2, completedCycles: [1, 2], checks: [] };
const pdf = new TextEncoder().encode('%PDF-fixture');
test('PDF success gate, two private recipients and durable no-retry receipts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'linkedin-pdf-'));
  const calls: string[] = [];
  const base = { journal, pdf, kiraChatId: '343610488', credentials: { manualLogin: 'fixture@example.invalid', manualPassword: 'private' }, store: fileDeliveryStore(dir),
    sendOne: async (input: { chatId: string }) => {
      calls.push(input.chatId);
      return { kind: 'telegram-response' as const, response: { ok: true as const, result: { message_id: 1, date: 1, chat: { id: Number(input.chatId), type: 'private' as const, first_name: 'Test' }, document: { file_id: 'id', file_unique_id: 'unique' } } } };
    } };
  try {
    for (const change of [{ passed: false }, { manualClientId: undefined }, { completedCycles: [1] }])
      await assert.rejects(deliverSuccessfulReport({ ...base, journal: { ...journal, ...change } }), /success_delivery_not_allowed/);
    assert.equal(calls.length, 0);
    assert.deepEqual(await deliverSuccessfulReport(base), { '343610488': 'sent', '315110920': 'sent' });
    assert.deepEqual(await deliverSuccessfulReport(base), { '343610488': 'already-attempted', '315110920': 'already-attempted' });
    assert.deepEqual(calls, ['343610488', '315110920']);
    assert.ok(!(await readFile(join(dir, 'delivery-315110920.json'), 'utf8')).includes('private'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('uncertain document delivery, crash after claim and rejection are never retried', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'linkedin-pdf-'));
  const store = fileDeliveryStore(dir); let calls = 0;
  try {
    assert.equal(await store.claim('343610488', 'fixture-hash'), true);
    const result = await deliverSuccessfulReport({ journal, pdf, kiraChatId: '343610488', credentials: { manualLogin: 'fixture', manualPassword: 'private' }, store,
      async sendOne() { calls++; throw Error('response lost: private'); } });
    assert.deepEqual(result, { '343610488': 'already-attempted', '315110920': 'uncertain' });
    assert.equal(calls, 1);
    const again = await deliverSuccessfulReport({ journal, pdf, kiraChatId: '343610488', credentials: { manualLogin: 'fixture', manualPassword: 'private' }, store,
      async sendOne() { throw Error('must not send'); } });
    assert.ok(Object.values(again).every(s => s === 'already-attempted'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
